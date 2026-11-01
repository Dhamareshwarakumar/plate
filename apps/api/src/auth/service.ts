import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@plate/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { auth } from '../db/schema.js';
import { hashPassword, verifyPassword } from './password.js';
import type { SessionStore } from './sessions.js';

const AUTH_ROW_ID = 1;

export class AuthBootstrapError extends Error {
  override readonly name = 'AuthBootstrapError';
}

export type BootstrapResult = 'already_configured' | 'seeded_from_bootstrap';

function assertPasswordPolicy(password: string, label: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new AuthBootstrapError(
      `${label} must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly sessions: SessionStore,
  ) {}

  hasPassword(): boolean {
    return (
      this.db.select({ id: auth.id }).from(auth).where(eq(auth.id, AUTH_ROW_ID)).get() !== undefined
    );
  }

  /**
   * Ensures a password hash exists. Seeds it from the bootstrap value only when none is stored,
   * so later edits to the deployment config never silently reset a password changed in-app.
   * Throws when neither exists: the server must not start unprotected.
   */
  async bootstrap(initialPassword: string | undefined): Promise<BootstrapResult> {
    if (this.hasPassword()) return 'already_configured';
    if (initialPassword === undefined) {
      throw new AuthBootstrapError(
        'No app password is configured yet. Set APP_INITIAL_PASSWORD (or APP_INITIAL_PASSWORD_FILE) for the first start.',
      );
    }
    assertPasswordPolicy(initialPassword, 'APP_INITIAL_PASSWORD');
    await this.setPassword(initialPassword, { isInitial: true });
    return 'seeded_from_bootstrap';
  }

  /** Overwrites the password from the bootstrap value and signs out every session (recovery path). */
  async resetFromBootstrap(
    initialPassword: string | undefined,
  ): Promise<{ revokedSessions: number }> {
    if (initialPassword === undefined) {
      throw new AuthBootstrapError(
        'Set APP_INITIAL_PASSWORD (or APP_INITIAL_PASSWORD_FILE) to the password you want, then run reset-password again.',
      );
    }
    assertPasswordPolicy(initialPassword, 'APP_INITIAL_PASSWORD');
    await this.setPassword(initialPassword, { isInitial: true });
    return { revokedSessions: this.sessions.revokeAll() };
  }

  async verify(password: string): Promise<boolean> {
    const row = this.db
      .select({ passwordHash: auth.passwordHash })
      .from(auth)
      .where(eq(auth.id, AUTH_ROW_ID))
      .get();
    if (!row) return false;
    return verifyPassword(row.passwordHash, password);
  }

  /**
   * Changes the password after verifying the current one. Returns false when the current
   * password does not match. Other sessions are revoked so a leaked old password cannot
   * keep a device signed in.
   */
  async changePassword(
    currentPassword: string,
    newPassword: string,
    callerSessionId: string,
  ): Promise<{ changed: true; revokedSessions: number } | { changed: false }> {
    if (!(await this.verify(currentPassword))) return { changed: false };
    await this.setPassword(newPassword, { isInitial: false });
    return { changed: true, revokedSessions: this.sessions.revokeAllExcept(callerSessionId) };
  }

  /** True while the stored password is still the bootstrap value; drives the "change it" banner. */
  isPasswordInitial(): boolean {
    const row = this.db
      .select({ passwordIsInitial: auth.passwordIsInitial })
      .from(auth)
      .where(eq(auth.id, AUTH_ROW_ID))
      .get();
    return row ? row.passwordIsInitial === 1 : false;
  }

  private async setPassword(password: string, options: { isInitial: boolean }): Promise<void> {
    const passwordHash = await hashPassword(password);
    const updatedAt = new Date().toISOString();
    const passwordIsInitial = options.isInitial ? 1 : 0;
    this.db
      .insert(auth)
      .values({ id: AUTH_ROW_ID, passwordHash, passwordIsInitial, updatedAt })
      .onConflictDoUpdate({ target: auth.id, set: { passwordHash, passwordIsInitial, updatedAt } })
      .run();
  }
}
