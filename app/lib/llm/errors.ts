import type { LlmProviderName } from "./config";

export class MissingFallbackProviderError extends Error {
  constructor() {
    super(
      "Ollama local service is unavailable and DeepSeek fallback is not configured. Run `ollama serve`, pull `qwen2.5-coder:7b`, or set DEEPSEEK_API_KEY."
    );
    this.name = "MissingFallbackProviderError";
  }
}

export class ProviderCallError extends Error {
  constructor(
    public readonly operationName: string,
    public readonly providerName: LlmProviderName
  ) {
    super(`${operationName} failed for provider ${providerName}`);
    this.name = "ProviderCallError";
  }
}

export function toLlmErrorResponse(error: unknown): Response {
  if (error instanceof MissingFallbackProviderError) {
    return Response.json({ error: error.message }, { status: 503 });
  }

  if (error instanceof ProviderCallError) {
    return Response.json(
      { error: "All configured AI providers failed to process the request" },
      { status: 503 }
    );
  }

  return Response.json({ error: "Failed to process AI request" }, { status: 500 });
}
