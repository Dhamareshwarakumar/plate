import type { AiFeature } from '@plate/shared';
import { FAKE_AI_MODEL } from '../../config.js';
import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiProvider,
} from './types.js';

/**
 * The canned answers, one per feature, exported so route tests and the screenshot script assert
 * against the same objects. They deliberately exercise the service's sanitising: in `parse_meal`
 * item 2 matches id 1 (the first food of a fresh database) and item 3 names an id that does not
 * exist; in `parse_recipe` the last ingredient does the same.
 */
export const FAKE_RESPONSES: Record<AiFeature, unknown> = {
  parse_meal: {
    items: [
      {
        description: '2 rotis',
        matchedFoodId: null,
        quantity: 80,
        basis: 'g',
        confidence: 'medium',
        suggestedFood: {
          name: 'Roti (whole wheat)',
          brand: null,
          basis: 'g',
          per100: {
            kcal: 297,
            protein: 9,
            carbs: 56,
            fat: 4,
            fiber: 7,
            sugar: null,
            saturatedFat: null,
            sodiumMg: null,
          },
          portions: [{ label: '1 roti', amount: 40 }],
        },
      },
      {
        description: 'a bowl of dal',
        matchedFoodId: 1,
        quantity: 200,
        basis: 'g',
        confidence: 'high',
        suggestedFood: null,
      },
      {
        description: 'one banana',
        matchedFoodId: 999999,
        quantity: 118,
        basis: 'g',
        confidence: 'medium',
        suggestedFood: null,
      },
    ],
    notes: 'Fake provider: canned answer for screenshots and tests.',
  },
  estimate_food: {
    per100: {
      kcal: 95,
      protein: 3.2,
      carbs: 11,
      fat: 4.1,
      fiber: 2.5,
      sugar: null,
      saturatedFat: null,
      sodiumMg: 310,
    },
    basis: 'g',
    portions: [{ label: '1 bowl', amount: 200 }],
    confidence: 'medium',
    rationale: 'Typical homemade sambar: lentils, vegetables, tamarind and a tempering of oil.',
  },
  parse_recipe: {
    name: 'Dal tadka',
    ingredients: [
      { description: '200 g red lentils', matchedFoodId: 1, amount: 200, suggestedFood: null },
      {
        description: '1 tbsp ghee',
        matchedFoodId: null,
        amount: 15,
        suggestedFood: {
          name: 'Ghee',
          brand: null,
          basis: 'g',
          per100: {
            kcal: 900,
            protein: 0,
            carbs: 0,
            fat: 100,
            fiber: null,
            sugar: null,
            saturatedFat: 62,
            sodiumMg: null,
          },
          portions: [{ label: '1 tbsp', amount: 15 }],
        },
      },
      {
        description: '1 onion',
        matchedFoodId: null,
        amount: 110,
        suggestedFood: {
          name: 'Onion',
          brand: null,
          basis: 'g',
          per100: {
            kcal: 40,
            protein: 1.1,
            carbs: 9.3,
            fat: 0.1,
            fiber: 1.7,
            sugar: 4.2,
            saturatedFat: null,
            sodiumMg: 4,
          },
          portions: [{ label: '1 medium', amount: 110 }],
        },
      },
      { description: 'salt to taste', matchedFoodId: 777777, amount: 5, suggestedFood: null },
    ],
    cookedWeight: 800,
    servings: 4,
  },
  weekly_digest: {
    lines: [
      'You logged 5 of 7 days and averaged 1,860 kcal, about 7% under your goal.',
      'Protein averaged 118 g a day; carbs 190 g; fat 62 g.',
      'Breakfast was your most consistent meal; dinner carried the extra calories on Friday.',
      'Oats showed up five times — your anchor food this week.',
    ],
    suggestion: 'Keep the weekday pattern and plan one lighter dinner on Friday.',
  },
};

/** Token counts every canned answer reports, so usage rows have something to count. */
export const FAKE_INPUT_TOKENS = 120;
export const FAKE_OUTPUT_TOKENS = 80;

/** Answer the fake returns once, before the canned object, when the request contains "garbage". */
export const FAKE_GARBAGE_TEXT = 'not json {';

/**
 * Dev/test driver (`AI_PROVIDER=fake`): no key, no network, canned answers keyed on the feature.
 * Trigger words anywhere in the user turn steer it so every state can be screenshotted and tested:
 * `fail` → an upstream 503, `nothing` (parse meal) → no items, `garbage` → one unusable answer
 * followed by the canned one (the service's retry path).
 */
export class FakeAiProvider implements AiProvider {
  readonly kind = 'fake' as const;
  readonly model = FAKE_AI_MODEL;
  private garbageServed = false;

  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const text = req.parts
      .map((part) => ('text' in part ? part.text : ''))
      .join('\n')
      .toLowerCase();
    if (/\bfail\b/.test(text)) {
      throw new AiProviderError('http', 'fake provider failure', 503);
    }
    if (/\bgarbage\b/.test(text) && !this.garbageServed) {
      this.garbageServed = true;
      return this.answer(FAKE_GARBAGE_TEXT);
    }
    if (req.feature === 'parse_meal' && /\bnothing\b/.test(text)) {
      return this.answer(JSON.stringify({ items: [], notes: 'No food found in the description.' }));
    }
    return this.answer(JSON.stringify(FAKE_RESPONSES[req.feature]));
  }

  private answer(text: string): AiCompletionResult {
    return { text, inputTokens: FAKE_INPUT_TOKENS, outputTokens: FAKE_OUTPUT_TOKENS };
  }
}
