import {
  DEFAULT_SETTINGS,
  settingsSchema,
  type Profile,
  type Settings,
  type SettingsPatch,
} from '@plate/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { profile, settings } from '../db/schema.js';

const SETTING_KEYS = ['tolerancePct', 'weekStart'] as const satisfies readonly (keyof Settings)[];
const PROFILE_ROW_ID = 1;

/**
 * User preferences (one JSON row per key in `settings`, missing or corrupt rows fall back to the
 * defaults) and the single-row calculator profile.
 */
export class SettingsService {
  constructor(private readonly db: Db) {}

  get(): Settings {
    const rows = this.db
      .select({ key: settings.key, valueJson: settings.valueJson })
      .from(settings)
      .where(inArray(settings.key, [...SETTING_KEYS]))
      .all();
    const result: Settings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      const key = row.key as (typeof SETTING_KEYS)[number];
      const parsed = settingsSchema.shape[key].safeParse(parseJson(row.valueJson));
      if (parsed.success) (result as Record<string, unknown>)[key] = parsed.data;
    }
    return result;
  }

  update(patch: SettingsPatch): Settings {
    const now = new Date().toISOString();
    this.db.transaction((tx) => {
      for (const key of SETTING_KEYS) {
        const value = patch[key];
        if (value === undefined) continue;
        const valueJson = JSON.stringify(value);
        tx.insert(settings)
          .values({ key, valueJson, updatedAt: now })
          .onConflictDoUpdate({ target: settings.key, set: { valueJson, updatedAt: now } })
          .run();
      }
    });
    return this.get();
  }

  getProfile(): Profile | null {
    const row = this.db.select().from(profile).where(eq(profile.id, PROFILE_ROW_ID)).get();
    return row ? toProfile(row) : null;
  }

  putProfile(input: Profile): Profile {
    const row = this.db
      .insert(profile)
      .values({ id: PROFILE_ROW_ID, ...input })
      .onConflictDoUpdate({ target: profile.id, set: input })
      .returning()
      .get();
    return toProfile(row);
  }
}

function toProfile(row: typeof profile.$inferSelect): Profile {
  return { sex: row.sex, birthDate: row.birthDate, heightCm: row.heightCm, activity: row.activity };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
