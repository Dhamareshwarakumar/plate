import { z } from 'zod';

/**
 * The JSON Schema keywords both structured-output modes accept. Gemini's `responseJsonSchema`
 * documents support for type/enum/items/anyOf/properties/required/additionalProperties (plus
 * $defs/$ref and descriptions) and rejects or ignores the rest; OpenAI's strict `json_schema`
 * mode rejects unsupported keywords outright. Everything dropped here (string lengths, patterns,
 * numeric bounds, array sizes) is re-checked by the zod schema after the call, so nothing is lost.
 */
const KEEP = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'anyOf',
  'additionalProperties',
  'description',
  '$defs',
  '$ref',
]);

const cache = new WeakMap<z.ZodType, Record<string, unknown>>();

/** The provider-facing JSON Schema of a zod schema, computed once per schema object. */
export function providerJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const cached = cache.get(schema);
  if (cached) return cached;
  const raw = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
  const normalised = normalise(raw) as Record<string, unknown>;
  cache.set(schema, normalised);
  return normalised;
}

/**
 * Recursively keeps only the supported keywords and rewrites `type: [T, 'null']` (what zod emits
 * for a nullable primitive) into `anyOf: [{ type: T, ...rest }, { type: 'null' }]`, the one
 * nullable form every provider agrees on. `$schema` goes with the rest of the unsupported keys.
 */
export function normalise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalise);
  if (node === null || typeof node !== 'object') return node;
  const input = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!KEEP.has(key)) continue;
    if (key === 'properties' || key === '$defs') {
      const members: Record<string, unknown> = {};
      for (const [name, member] of Object.entries(value as Record<string, unknown>)) {
        members[name] = normalise(member);
      }
      out[key] = members;
    } else if (key === 'additionalProperties' && typeof value === 'object') {
      out[key] = normalise(value);
    } else {
      out[key] = normalise(value);
    }
  }
  const type = out.type;
  if (Array.isArray(type) && type.includes('null') && type.length === 2) {
    const other = type.find((t) => t !== 'null') as string;
    const { type: _type, description, ...rest } = out;
    const variant: Record<string, unknown> = { type: other, ...rest };
    return {
      ...(description === undefined ? {} : { description }),
      anyOf: [variant, { type: 'null' }],
    };
  }
  return out;
}
