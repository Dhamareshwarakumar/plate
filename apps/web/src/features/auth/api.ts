import {
  okResponseSchema,
  sessionInfoSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type SessionInfo,
} from '@plate/shared';
import { z } from 'zod';
import { apiRequest, ApiClientError } from '@/lib/api';

/** Resolves to null when there is no live session (401), so callers can tell "signed out" from "broken". */
export async function fetchSession(signal?: AbortSignal): Promise<SessionInfo | null> {
  try {
    return await apiRequest('/auth/session', {
      schema: sessionInfoSchema,
      notifyUnauthenticated: false,
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 401) return null;
    throw err;
  }
}

export function login(body: LoginRequest): Promise<SessionInfo> {
  return apiRequest('/auth/login', {
    method: 'POST',
    body,
    schema: sessionInfoSchema,
    notifyUnauthenticated: false,
  });
}

export function logout(): Promise<{ ok: true }> {
  return apiRequest('/auth/logout', { method: 'POST', schema: okResponseSchema });
}

const changePasswordResponseSchema = okResponseSchema.extend({
  signedOutOtherDevices: z.number().int().nonnegative(),
});
export type ChangePasswordResponse = z.infer<typeof changePasswordResponseSchema>;

export function changePassword(body: ChangePasswordRequest): Promise<ChangePasswordResponse> {
  return apiRequest('/auth/change-password', {
    method: 'POST',
    body,
    schema: changePasswordResponseSchema,
  });
}
