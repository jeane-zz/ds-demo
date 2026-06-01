export type LlmProviderName = "ollama" | "deepseek";

export interface LlmProviderConfig {
  name: LlmProviderName;
  baseURL: string;
  model: string;
  apiKey?: string;
}

export interface LlmConfig {
  primary: LlmProviderConfig;
  fallback: LlmProviderConfig;
}

type Env = Partial<Record<string, string | undefined>>;

function readEnv(env: Env, key: string, fallback: string): string {
  const value = env[key];
  return value && value.trim() ? value.trim() : fallback;
}

function readOptionalEnv(env: Env, key: string): string | undefined {
  const value = env[key];
  return value && value.trim() ? value.trim() : undefined;
}

export function getLlmConfig(env: Env = process.env): LlmConfig {
  return {
    primary: {
      name: "ollama",
      baseURL: readEnv(env, "OLLAMA_BASE_URL", "http://localhost:11434/v1"),
      model: readEnv(env, "OLLAMA_MODEL", "qwen2.5-coder:7b"),
      apiKey: "ollama",
    },
    fallback: {
      name: "deepseek",
      baseURL: readEnv(env, "DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
      model: readEnv(env, "DEEPSEEK_MODEL", "deepseek-chat"),
      apiKey: readOptionalEnv(env, "DEEPSEEK_API_KEY"),
    },
  };
}
