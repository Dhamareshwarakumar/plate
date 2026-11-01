import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Any non-empty password is accepted at login; the server decides whether it matches. */
export const loginRequestSchema = z.object({
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(PASSWORD_MAX_LENGTH),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
      .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'The new password must differ from the current one',
    path: ['newPassword'],
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const sessionInfoSchema = z.object({
  authenticated: z.literal(true),
  /** ISO-8601 timestamp of when this session was created. */
  createdAt: z.string(),
  /** ISO-8601 timestamp after which the session expires if unused. */
  expiresAt: z.string(),
  /** True while the password is still the one seeded from deployment config (or a reset). */
  passwordIsInitial: z.boolean(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;
