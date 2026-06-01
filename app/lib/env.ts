/**
 * 环境变量工具。
 *
 * Ollama 是默认本地模型路径，因此 DeepSeek 凭证只在 fallback 时由 LLM provider 层校验。
 */

export class MissingEnvError extends Error {
  constructor(public readonly key: string) {
    super(`Missing required environment variable: ${key}`);
    this.name = "MissingEnvError";
  }
}

export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new MissingEnvError(key);
  }
  return value;
}
