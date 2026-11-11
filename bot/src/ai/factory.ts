/**
 * Provider construction.
 *
 * One place that maps configuration to a concrete provider, so the bot and the host build the same
 * thing from the same settings.
 */

import { OllamaProvider, OpenAiCompatibleProvider, type AiProvider } from './provider';

export interface ProviderFactoryOptions {
  provider: 'ollama' | 'openai' | 'none';
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'llama3.2';

/** Returns `null` for `none`, which tells the planner to use the deterministic interpreter. */
export function createProvider(options: ProviderFactoryOptions): AiProvider | null {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (options.provider === 'ollama') {
    return new OllamaProvider({
      baseUrl: options.baseUrl ?? DEFAULT_OLLAMA_URL,
      model: options.model ?? DEFAULT_OLLAMA_MODEL,
      timeoutMs,
      fetchImpl: options.fetchImpl,
    });
  }
  if (options.provider === 'openai') {
    return new OpenAiCompatibleProvider({
      baseUrl: options.baseUrl ?? 'http://127.0.0.1:8080',
      model: options.model ?? 'gpt-3.5-turbo',
      apiKey: options.apiKey,
      timeoutMs,
      fetchImpl: options.fetchImpl,
    });
  }
  return null;
}
