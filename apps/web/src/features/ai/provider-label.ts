import type { AiAbout } from '@plate/shared';

/** Card title form: "Google Gemini", "OpenAI-compatible API", "Fake provider (development)". */
export function providerName(ai: AiAbout): string {
  switch (ai.provider) {
    case 'gemini':
      return 'Google Gemini';
    case 'openai_compatible':
      return 'OpenAI-compatible API';
    case 'fake':
      return 'Fake provider (development)';
    case 'none':
      return 'Off';
  }
}

/**
 * Sentence form for the privacy lines ("Sent to Google Gemini (gemini-3.8-flash) for analysis."):
 * names the model too, because that is what the user configured and what the bill is for.
 */
export function providerPhrase(ai: AiAbout): string {
  const model = ai.model ? ` (${ai.model})` : '';
  switch (ai.provider) {
    case 'gemini':
      return `Google Gemini${model}`;
    case 'openai_compatible':
      return `the configured OpenAI-compatible API${model}`;
    case 'fake':
      return `the fake provider${model}`;
    case 'none':
      return 'no provider';
  }
}
