import OpenAI from "openai";
import { getLlmConfig, type LlmConfig, type LlmProviderConfig } from "./config";
import { MissingFallbackProviderError, ProviderCallError } from "./errors";

interface LlmLogger {
  warn: (message: string) => void;
  error: (message: string) => void;
}

interface RunWithFallbackOptions {
  operationName: string;
  config?: LlmConfig;
  logger?: LlmLogger;
}

export function createOpenAIClient(provider: LlmProviderConfig): OpenAI {
  return new OpenAI({
    apiKey: provider.apiKey ?? "missing",
    baseURL: provider.baseURL,
  });
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown provider error";
}

export async function runWithLlmFallback<T>(
  operation: (provider: LlmProviderConfig) => Promise<T>,
  options: RunWithFallbackOptions
): Promise<T> {
  const config = options.config ?? getLlmConfig();
  const logger = options.logger ?? console;

  try {
    return await operation(config.primary);
  } catch (primaryError) {
    logger.warn(
      `[llm] ${options.operationName} failed on ${config.primary.name}: ${summarizeError(
        primaryError
      )}. Trying fallback.`
    );
  }

  if (!config.fallback.apiKey) {
    throw new MissingFallbackProviderError();
  }

  try {
    return await operation(config.fallback);
  } catch (fallbackError) {
    logger.error(
      `[llm] ${options.operationName} failed on ${config.fallback.name}: ${summarizeError(
        fallbackError
      )}.`
    );
    throw new ProviderCallError(options.operationName, config.fallback.name);
  }
}
