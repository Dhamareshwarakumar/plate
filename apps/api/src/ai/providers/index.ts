import type { AppConfig } from '../../config.js';
import { FakeAiProvider } from './fake.js';
import { GeminiProvider } from './gemini.js';
import { OpenAiCompatibleProvider } from './openai-compatible.js';
import type { AiProvider, AiProviderLogger } from './types.js';

export type { AiCompletionRequest, AiCompletionResult, AiPart, AiProvider } from './types.js';
export { AiProviderError } from './types.js';

/**
 * The configured driver, or null when `AI_PROVIDER=none`. `loadConfig` has already checked that
 * the real providers have a key, a model and (OpenAI-compatible) a base URL.
 */
export function createAiProvider(config: AppConfig, logger?: AiProviderLogger): AiProvider | null {
  switch (config.aiProvider) {
    case 'none':
      return null;
    case 'fake':
      return new FakeAiProvider();
    case 'gemini':
      return new GeminiProvider({
        apiKey: requireValue(config.aiApiKey, 'AI_API_KEY'),
        model: requireValue(config.aiModel, 'AI_MODEL'),
        timeoutMs: config.aiTimeoutMs,
        baseUrl: config.aiBaseUrl,
        logger,
      });
    case 'openai_compatible':
      return new OpenAiCompatibleProvider({
        apiKey: requireValue(config.aiApiKey, 'AI_API_KEY'),
        model: requireValue(config.aiModel, 'AI_MODEL'),
        baseUrl: requireValue(config.aiBaseUrl, 'AI_BASE_URL'),
        timeoutMs: config.aiTimeoutMs,
        logger,
      });
  }
}

function requireValue(value: string | null | undefined, name: string): string {
  if (value === undefined || value === null || value.length === 0) {
    throw new Error(`AI_PROVIDER needs ${name}`);
  }
  return value;
}
