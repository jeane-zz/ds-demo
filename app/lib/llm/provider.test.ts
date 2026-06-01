import { describe, expect, it, vi } from "vitest";
import { getLlmConfig } from "./config";
import { MissingFallbackProviderError, ProviderCallError } from "./errors";
import { runWithLlmFallback } from "./provider";

describe("getLlmConfig", () => {
  it("uses Ollama qwen2.5-coder:7b as the default primary provider", () => {
    const config = getLlmConfig({});

    expect(config.primary).toEqual({
      name: "ollama",
      baseURL: "http://localhost:11434/v1",
      model: "qwen2.5-coder:7b",
      apiKey: "ollama",
    });
    expect(config.fallback).toEqual({
      name: "deepseek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: undefined,
    });
  });

  it("uses env overrides for Ollama and DeepSeek", () => {
    const config = getLlmConfig({
      OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
      OLLAMA_MODEL: "qwen2.5-coder:14b",
      DEEPSEEK_API_KEY: "deepseek-key",
      DEEPSEEK_BASE_URL: "https://example.test",
      DEEPSEEK_MODEL: "deepseek-reasoner",
    });

    expect(config.primary.baseURL).toBe("http://127.0.0.1:11434/v1");
    expect(config.primary.model).toBe("qwen2.5-coder:14b");
    expect(config.fallback.apiKey).toBe("deepseek-key");
    expect(config.fallback.baseURL).toBe("https://example.test");
    expect(config.fallback.model).toBe("deepseek-reasoner");
  });
});

describe("runWithLlmFallback", () => {
  it("retries DeepSeek when Ollama fails and fallback is configured", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("ollama down"))
      .mockResolvedValueOnce("deepseek result");

    const result = await runWithLlmFallback(operation, {
      operationName: "unit test",
      config: getLlmConfig({ DEEPSEEK_API_KEY: "deepseek-key" }),
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(result).toBe("deepseek result");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(operation.mock.calls[0][0].name).toBe("ollama");
    expect(operation.mock.calls[1][0].name).toBe("deepseek");
  });

  it("throws a clear fallback config error when Ollama fails and DeepSeek key is missing", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("ollama down"));

    await expect(
      runWithLlmFallback(operation, {
        operationName: "unit test",
        config: getLlmConfig({}),
        logger: { warn: vi.fn(), error: vi.fn() },
      })
    ).rejects.toBeInstanceOf(MissingFallbackProviderError);

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("wraps provider failures without exposing prompts or API keys", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("ollama prompt secret"))
      .mockRejectedValueOnce(new Error("deepseek key secret"));

    await expect(
      runWithLlmFallback(operation, {
        operationName: "unit test",
        config: getLlmConfig({ DEEPSEEK_API_KEY: "deepseek-key" }),
        logger: { warn: vi.fn(), error: vi.fn() },
      })
    ).rejects.toBeInstanceOf(ProviderCallError);
  });
});
