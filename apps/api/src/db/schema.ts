import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Single-row table (id = 1) holding the app password hash. */
export const auth = sqliteTable('auth', {
  id: integer('id').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Browser sessions. `id` is the SHA-256 of the random token held by the cookie, so a copy of the
 * database alone is not enough to hijack a session.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_expires_at_idx').on(t.expiresAt)],
);
