import { describe, expect, it } from 'vitest';
import { changePasswordRequestSchema, loginRequestSchema } from './auth.js';

describe('loginRequestSchema', () => {
  it('accepts any non-empty password', () => {
    expect(loginRequestSchema.safeParse({ password: 'password' }).success).toBe(true);
  });
  it('rejects an empty password', () => {
    expect(loginRequestSchema.safeParse({ password: '' }).success).toBe(false);
  });
});

describe('changePasswordRequestSchema', () => {
  it('requires at least 8 characters for the new password', () => {
    const r = changePasswordRequestSchema.safeParse({
      currentPassword: 'password',
      newPassword: 'short',
    });
    expect(r.success).toBe(false);
  });
  it('rejects reusing the current password', () => {
    const r = changePasswordRequestSchema.safeParse({
      currentPassword: 'password',
      newPassword: 'password',
    });
    expect(r.success).toBe(false);
  });
  it('accepts a valid change', () => {
    const r = changePasswordRequestSchema.safeParse({
      currentPassword: 'password',
      newPassword: 'much-stronger-1',
    });
    expect(r.success).toBe(true);
  });
});
