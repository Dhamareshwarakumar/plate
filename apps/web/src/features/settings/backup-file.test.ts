import { BACKUP_FORMAT, BACKUP_TABLE_KEYS, BACKUP_VERSION, backupCounts } from '@plate/shared';
import { describe, expect, it } from 'vitest';
import { readBackupFile } from './backup-file';

const minimal = () =>
  JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: '2025-10-20T10:00:00.000Z',
    appVersion: '0.1.0',
    data: Object.fromEntries(BACKUP_TABLE_KEYS.map((k) => [k, []])),
  });

describe('readBackupFile', () => {
  it('rejects text that is not JSON', () => {
    const result = readBackupFile('{"hello":');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('not_json');
    expect(result.message).toBe('This file is not valid JSON.');
  });

  it('rejects JSON that is not a Plate backup', () => {
    const result = readBackupFile('{"hello":1}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('not_a_backup');
    expect(result.message).toBe('This file is not a Plate backup');
  });

  it('parses a valid backup so the sheet can show its counts', () => {
    const result = readBackupFile(minimal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.appVersion).toBe('0.1.0');
    expect(backupCounts(result.backup)).toEqual({
      foods: 0,
      entries: 0,
      days: 0,
      weights: 0,
      goals: 0,
    });
  });
});
