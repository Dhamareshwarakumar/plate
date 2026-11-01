import type { Profile, Settings } from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, login, type TestContext } from './helpers.js';

let ctx: TestContext;
let cookie: string;

beforeEach(async () => {
  ctx = await createTestApp();
  cookie = await login(ctx.app);
});
afterEach(() => ctx.close());

const api = (method: 'GET' | 'PUT', url: string, payload?: unknown) => {
  const options: InjectOptions = { method, url, headers: { cookie } };
  if (payload !== undefined) options.payload = payload as NonNullable<InjectOptions['payload']>;
  return ctx.app.inject(options);
};

const paths = (res: { json: () => { error: { details?: unknown } } }) =>
  (res.json().error.details as { path: string }[]).map((d) => d.path);

const profile = { sex: 'male', birthDate: '1995-06-15', heightCm: 180, activity: 'moderate' };

describe('auth gate on settings routes', () => {
  it('denies anonymous access on every route', async () => {
    const routes: ['GET' | 'PUT', string][] = [
      ['GET', '/api/settings'],
      ['PUT', '/api/settings'],
      ['GET', '/api/profile'],
      ['PUT', '/api/profile'],
    ];
    for (const [method, url] of routes) {
      const options: InjectOptions = { method, url };
      if (method !== 'GET') options.payload = { tolerancePct: 5 };
      const res = await ctx.app.inject(options);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Session/);
    }
  });
});

describe('settings', () => {
  it('starts with the defaults', async () => {
    const res = await api('GET', '/api/settings');
    expect(res.statusCode).toBe(200);
    expect(res.json<Settings>()).toEqual({ tolerancePct: 10, weekStart: 'monday' });
  });

  it('rejects out-of-range and empty patches with the offending path', async () => {
    const tooHigh = await api('PUT', '/api/settings', { tolerancePct: 30 });
    expect(tooHigh.statusCode).toBe(400);
    expect(tooHigh.json().error.code).toBe('VALIDATION_ERROR');
    expect(paths(tooHigh)).toEqual(['tolerancePct']);

    const fraction = await api('PUT', '/api/settings', { tolerancePct: 7.5 });
    expect(fraction.statusCode).toBe(400);
    expect(paths(fraction)).toEqual(['tolerancePct']);

    const badWeek = await api('PUT', '/api/settings', { weekStart: 'friday' });
    expect(badWeek.statusCode).toBe(400);
    expect(paths(badWeek)).toEqual(['weekStart']);

    expect((await api('PUT', '/api/settings', {})).statusCode).toBe(400);
  });

  it('updates one key at a time and keeps the others', async () => {
    const first = await api('PUT', '/api/settings', { tolerancePct: 15 });
    expect(first.statusCode).toBe(200);
    expect(first.json<Settings>()).toEqual({ tolerancePct: 15, weekStart: 'monday' });
    expect((await api('GET', '/api/settings')).json<Settings>()).toEqual({
      tolerancePct: 15,
      weekStart: 'monday',
    });

    const second = await api('PUT', '/api/settings', { weekStart: 'sunday' });
    expect(second.json<Settings>()).toEqual({ tolerancePct: 15, weekStart: 'sunday' });

    const third = await api('PUT', '/api/settings', { tolerancePct: 0 });
    expect(third.json<Settings>()).toEqual({ tolerancePct: 0, weekStart: 'sunday' });
  });
});

describe('profile', () => {
  it('is null until set', async () => {
    const res = await api('GET', '/api/profile');
    expect(res.statusCode).toBe(200);
    expect(res.json<Profile | null>()).toBeNull();
  });

  it('validates every field with the offending path', async () => {
    const height = await api('PUT', '/api/profile', { ...profile, heightCm: 90 });
    expect(height.statusCode).toBe(400);
    expect(paths(height)).toEqual(['heightCm']);

    const future = await api('PUT', '/api/profile', { ...profile, birthDate: '2999-01-01' });
    expect(future.statusCode).toBe(400);
    expect(paths(future)).toEqual(['birthDate']);

    const sex = await api('PUT', '/api/profile', { ...profile, sex: 'x' });
    expect(sex.statusCode).toBe(400);
    expect(paths(sex)).toEqual(['sex']);

    const activity = await api('PUT', '/api/profile', { ...profile, activity: 'couch' });
    expect(activity.statusCode).toBe(400);
    expect(paths(activity)).toEqual(['activity']);

    const missing = await api('PUT', '/api/profile', { sex: 'male' });
    expect(missing.statusCode).toBe(400);
    expect(paths(missing)).toEqual(expect.arrayContaining(['birthDate', 'heightCm', 'activity']));
  });

  it('stores, returns and replaces the single profile', async () => {
    const put = await api('PUT', '/api/profile', profile);
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json<Profile>()).toEqual(profile);
    expect((await api('GET', '/api/profile')).json<Profile | null>()).toEqual(profile);

    const replaced = {
      sex: 'female',
      birthDate: '2000-02-29',
      heightCm: 165.5,
      activity: 'active',
    };
    const second = await api('PUT', '/api/profile', replaced);
    expect(second.statusCode).toBe(200);
    expect((await api('GET', '/api/profile')).json<Profile | null>()).toEqual(replaced);
  });
});
