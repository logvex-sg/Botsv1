/**
 * AI provider abstraction.
 *
 * The planner asks a provider for a JSON plan. Two providers ship:
 *
 *   - `OllamaProvider` talks to a local Ollama server's `/api/chat` endpoint.
 *   - `OpenAiCompatibleProvider` talks to any OpenAI-shaped `/v1/chat/completions` endpoint.
 *   - `DeterministicProvider` is a keyword interpreter that needs no network at all.
 *
 * The deterministic provider is not a stub. It is the offline path the runtime falls back to when
 * no model is reachable, and it is what makes the natural-language feature work on a machine with
 * no Ollama installed.
 *
 * This module deliberately imports nothing from Mineflayer, so the host can depend on `@logvex/bot/ai`
 * without pulling the Minecraft protocol stack into Electron's main process.
 */

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderRequest {
  messages: ProviderMessage[];
  /** Ask the provider for JSON output. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ProviderResponse {
  text: string;
  model: string;
  provider: string;
  /** Wall-clock duration of the call. */
  durationMs: number;
}

export interface AiProvider {
  readonly id: string;
  readonly name: string;
  /** Whether this provider needs a network round-trip. */
  readonly remote: boolean;
  available(): Promise<boolean>;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class OllamaProvider implements AiProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama';
  readonly remote = true;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async available(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 5_000)),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const started = Date.now();
    const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        stream: false,
        ...(request.json ? { format: 'json' } : {}),
        options: {
          temperature: request.temperature ?? 0.2,
          ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
        },
      }),
      signal: request.signal ?? AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Ollama responded ${response.status}`);
    }
    const body = (await response.json()) as { message?: { content?: string }; model?: string };
    const text = body.message?.content ?? '';
    return { text, model: body.model ?? this.model, provider: this.id, durationMs: Date.now() - started };
  }
}

export interface OpenAiOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** Any endpoint that speaks the OpenAI chat-completions shape, including llama.cpp and vLLM. */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI-compatible';
  readonly remote = true;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async available(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/models`, {
        headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 5_000)),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const started = Date.now();
    const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        ...(request.json ? { response_format: { type: 'json_object' } } : {}),
        ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      }),
      signal: request.signal ?? AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) throw new Error(`provider responded ${response.status}`);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; model?: string };
    const text = body.choices?.[0]?.message?.content ?? '';
    return { text, model: body.model ?? this.model, provider: this.id, durationMs: Date.now() - started };
  }
}
