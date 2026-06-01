# Ollama Local-First LLM Integration Design

## Goal

Integrate Ollama as the default local model provider for all AI features, with DeepSeek kept as an optional fallback when the local service is unavailable.

## Scope

This design covers these existing AI call sites:

- Main chat streaming API at `app/api/chat/route.ts`
- Session title generation at `app/api/title/route.ts`
- Conversation compression at `app/api/compress/route.ts`
- Development document extraction at `app/api/documents/extract/route.ts`

The implementation should not add a provider selector UI. The provider choice is server-side and configuration-driven.

## Confirmed Decisions

- Default provider order: Ollama first, DeepSeek fallback.
- Default Ollama model: `qwen2.5-coder:7b`.
- All AI features use the same local-first behavior.
- DeepSeek remains available only when `DEEPSEEK_API_KEY` is configured.
- `http://localhost:11434/v1` is treated as an API base URL, not a browser page.

## Architecture

Add a small LLM provider layer under `app/lib/llm`. Existing API routes should call this layer instead of constructing provider clients directly.

The provider layer is responsible for:

- Reading model and base URL configuration.
- Creating OpenAI-compatible clients for Ollama and DeepSeek.
- Trying Ollama before DeepSeek.
- Returning clear provider/configuration errors.
- Keeping route code focused on request validation and response shaping.

The main chat route should continue using the OpenAI SDK style already present in `app/api/chat/route.ts`, because that route currently depends on OpenAI-compatible streaming and tool calling. Ollama's OpenAI-compatible `/v1` endpoint should allow the same request shape to be reused as much as possible.

The document extraction route currently uses Vercel AI SDK. It can either call a helper built on the same provider configuration or be refactored to the shared OpenAI-compatible provider helpers. The implementation should choose the smaller change that keeps provider selection centralized.

## Configuration

Supported environment variables:

- `OLLAMA_BASE_URL`: optional, defaults to `http://localhost:11434/v1`
- `OLLAMA_MODEL`: optional, defaults to `qwen2.5-coder:7b`
- `DEEPSEEK_API_KEY`: optional at startup, required only for fallback
- `DEEPSEEK_BASE_URL`: optional, defaults to `https://api.deepseek.com`
- `DEEPSEEK_MODEL`: optional, defaults to `deepseek-chat`

The current startup warning for missing `DEEPSEEK_API_KEY` should be adjusted. Missing DeepSeek credentials should not make local-first Ollama usage look misconfigured. A missing key only matters when fallback is needed.

## Runtime Behavior

For every AI operation:

1. Try Ollama with the configured local model.
2. If Ollama succeeds, return the Ollama result.
3. If Ollama fails because the service is unreachable, the model is missing, or the API returns an error, log a concise server-side warning.
4. If `DEEPSEEK_API_KEY` is present, retry the same operation with DeepSeek.
5. If fallback is not configured, return a 503 response explaining both conditions:
   - Ollama local service is unavailable.
   - DeepSeek fallback is not configured.

The 503 response should guide the user to run:

```bash
ollama serve
ollama pull qwen2.5-coder:7b
```

or configure:

```bash
DEEPSEEK_API_KEY=your_deepseek_api_key
```

The main chat tool-calling flow should use the same provider order for each model call. The implementation does not need to expose the chosen provider in the frontend.

## Error Handling

Introduce explicit provider errors instead of leaking raw SDK errors into routes:

- Local provider unavailable.
- Fallback provider missing configuration.
- All providers failed.

Routes should continue returning JSON errors with suitable HTTP status codes for non-streaming failures. The streaming chat route should return the same user-visible behavior it has today when a request cannot be started.

Server logs should include which provider failed and whether fallback was attempted, without logging API keys or full prompts.

## Documentation

Update `README.md` so the project description and setup instructions say:

- The default model path is Ollama local-first.
- DeepSeek is optional fallback, not the default requirement.
- To prepare Ollama:

```bash
ollama pull qwen2.5-coder:7b
ollama serve
```

- To verify Ollama is running, use:

```bash
curl http://localhost:11434/api/tags
curl http://localhost:11434/v1/models
```

- `http://localhost:11434/v1` is an API base URL and may not open as a useful browser page.

## Testing

Add focused tests for the provider layer:

- Default config resolves to Ollama at `http://localhost:11434/v1` with model `qwen2.5-coder:7b`.
- When Ollama fails and `DEEPSEEK_API_KEY` exists, the operation retries with DeepSeek.
- When Ollama fails and `DEEPSEEK_API_KEY` is missing, the provider layer raises a clear fallback configuration error.

API route tests are not required for this change unless the implementation significantly alters route behavior. The main verification commands are:

```bash
npm run lint
npm run build
```

## Non-Goals

- No frontend provider/model selector.
- No per-session provider persistence.
- No changes to the browser-side embedding model used for RAG and semantic search.
- No replacement of the existing local SQLite or IndexedDB storage behavior.

## Acceptance Criteria

- All AI call sites use Ollama first.
- DeepSeek fallback works when configured.
- Missing DeepSeek credentials do not block normal Ollama usage.
- Users receive actionable errors when Ollama is unavailable and fallback is not configured.
- README accurately documents local-first setup and validation.
- Lint and production build pass.
