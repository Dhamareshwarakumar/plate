import {
  aiEstimateFoodResponseSchema,
  aiParseMealResponseSchema,
  aiRecipeResponseSchema,
  aiWeeklyDigestModelSchema,
} from '@plate/shared';
import { describe, expect, it } from 'vitest';
import { normalise, providerJsonSchema } from '../src/ai/json-schema.js';

type Node = Record<string, unknown>;

/** Every key that appears anywhere in the schema tree. */
function allKeys(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) allKeys(item, out);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      out.add(key);
      // Property names are data, not keywords.
      if (key === 'properties' || key === '$defs') {
        for (const member of Object.values(value as Node)) allKeys(member, out);
      } else {
        allKeys(value, out);
      }
    }
  }
  return out;
}

describe('providerJsonSchema', () => {
  const schema = providerJsonSchema(aiParseMealResponseSchema);
  const keys = allKeys(schema);

  it('drops the keywords neither provider accepts and keeps the structural ones', () => {
    for (const dropped of [
      '$schema',
      'minimum',
      'maximum',
      'exclusiveMinimum',
      'exclusiveMaximum',
      'minLength',
      'maxLength',
      'pattern',
      'format',
      'minItems',
      'maxItems',
      'default',
    ]) {
      expect(keys.has(dropped), dropped).toBe(false);
    }
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['items', 'notes']);
  });

  it('expresses nullable fields as anyOf with a null branch', () => {
    const items = (schema.properties as Node).items as Node;
    const item = items.items as Node;
    const props = item.properties as Node;
    expect((props.matchedFoodId as Node).anyOf).toEqual([{ type: 'integer' }, { type: 'null' }]);
    expect((props.suggestedFood as Node).anyOf).toEqual([
      expect.objectContaining({ type: 'object', additionalProperties: false }),
      { type: 'null' },
    ]);
    expect(((schema.properties as Node).notes as Node).anyOf).toEqual([
      { type: 'string' },
      { type: 'null' },
    ]);
    // Enums survive; the literal-null brand of a suggested food is a plain null type.
    expect((props.confidence as Node).enum).toEqual(['low', 'medium', 'high']);
    const suggested = ((props.suggestedFood as Node).anyOf as Node[])[0]!;
    expect((suggested.properties as Node).brand).toEqual({ type: 'null' });
  });

  it('lists every property as required on every object (what strict mode demands)', () => {
    const check = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(check);
      if (!node || typeof node !== 'object') return;
      const n = node as Node;
      if (n.type === 'object' && n.properties) {
        expect([...(n.required as string[])].sort()).toEqual(
          Object.keys(n.properties as Node).sort(),
        );
        Object.values(n.properties as Node).forEach(check);
      }
      if (n.items) check(n.items);
      if (n.anyOf) check(n.anyOf);
    };
    for (const s of [
      aiParseMealResponseSchema,
      aiEstimateFoodResponseSchema,
      aiRecipeResponseSchema,
      aiWeeklyDigestModelSchema,
    ]) {
      check(providerJsonSchema(s));
    }
  });

  it('is computed once per schema object', () => {
    expect(providerJsonSchema(aiParseMealResponseSchema)).toBe(schema);
  });
});

describe('normalise', () => {
  it('rewrites a type array with null into anyOf and keeps the description outside the branches', () => {
    expect(
      normalise({
        type: ['string', 'null'],
        description: 'd',
        maxLength: 5,
        enum: ['a', 'b', null],
      }),
    ).toEqual({
      description: 'd',
      anyOf: [{ type: 'string', enum: ['a', 'b', null] }, { type: 'null' }],
    });
  });

  it('recurses into properties, items, anyOf and $defs', () => {
    expect(
      normalise({
        $schema: 'x',
        type: 'object',
        properties: { a: { type: 'number', minimum: 0 } },
        required: ['a'],
        additionalProperties: false,
        $defs: {
          b: { type: 'array', items: { type: 'integer', exclusiveMinimum: 0 }, maxItems: 3 },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: { a: { type: 'number' } },
      required: ['a'],
      additionalProperties: false,
      $defs: { b: { type: 'array', items: { type: 'integer' } } },
    });
  });
});
