import { and, eq, lt, ne } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/index.js';
import { sessions } from '../db/schema.js';

export interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

/** The sliding expiry is only persisted when the session was last touched this long ago. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class SessionStore {
  constructor(
    private readonly db: Db,
    private readonly ttlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Creates a session and returns the raw token that goes into the cookie. */
  create(userAgent: string | undefined): { token: string; session: Session } {
    const token = randomBytes(32).toString('base64url');
    const nowIso = this.now().toISOString();
    const session: Session = {
      id: hashToken(token),
      createdAt: nowIso,
      lastSeenAt: nowIso,
      expiresAt: new Date(this.now().getTime() + this.ttlMs).toISOString(),
    };
    this.db
      .insert(sessions)
      .values({ ...session, userAgent: userAgent?.slice(0, 512) ?? null })
      .run();
    return { token, session };
  }

  /**
   * Resolves a cookie token to a live session, extending the sliding expiry when due.
   * Expired sessions are deleted on sight.
   */
  resolve(token: string): Session | undefined {
    const id = hashToken(token);
    const row = this.db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!row) return undefined;

    const now = this.now();
    if (new Date(row.expiresAt).getTime() <= now.getTime()) {
      this.db.delete(sessions).where(eq(sessions.id, id)).run();
      return undefined;
    }

    if (now.getTime() - new Date(row.lastSeenAt).getTime() >= TOUCH_INTERVAL_MS) {
      const lastSeenAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + this.ttlMs).toISOString();
      this.db.update(sessions).set({ lastSeenAt, expiresAt }).where(eq(sessions.id, id)).run();
      return { id, createdAt: row.createdAt, lastSeenAt, expiresAt };
    }

    return { id, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, expiresAt: row.expiresAt };
  }

  revoke(sessionId: string): void {
    this.db.delete(sessions).where(eq(sessions.id, sessionId)).run();
  }

  /** Signs out every device except the one making the change. */
  revokeAllExcept(sessionId: string): number {
    return this.db.delete(sessions).where(ne(sessions.id, sessionId)).run().changes;
  }

  revokeAll(): number {
    return this.db.delete(sessions).run().changes;
  }

  /** Housekeeping: removes sessions whose expiry has passed. */
  purgeExpired(): number {
    const nowIso = this.now().toISOString();
    return this.db
      .delete(sessions)
      .where(and(lt(sessions.expiresAt, nowIso)))
      .run().changes;
  }
}
