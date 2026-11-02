import { parseBackup, type ParseBackupResult } from '@plate/shared';

export type ReadBackupResult =
  ParseBackupResult | { ok: false; code: 'not_json'; message: string; issues: [] };

/** Text of a picked file → parsed backup, with the same staged messages the API would give. */
export function readBackupFile(text: string): ReadBackupResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, code: 'not_json', message: 'This file is not valid JSON.', issues: [] };
  }
  return parseBackup(json);
}
