import type {
  PushPayload,
  PushSendResult,
  PushSubscribeRequest,
  PushSubscriptionInfo,
} from '@plate/shared';
import { asc, eq, sql } from 'drizzle-orm';
import webpush from 'web-push';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { pushSubscriptions, settings } from '../db/schema.js';
import { AppError } from '../errors.js';

export interface PushServiceOptions {
  /** `mailto:` or `https:` contact sent to push services in the VAPID token. */
  vapidSubject: string;
  /** Socket timeout per delivery. */
  timeoutMs?: number;
  logger?: {
    info(obj: object, msg: string): void;
    warn(obj: object, msg: string): void;
  };
}

export interface SendOptions {
  /** How long the push service keeps the message for an offline device, in seconds. */
  ttlSeconds: number;
  /** Deliver to this subscription only; every subscription when omitted. */
  endpoint?: string;
}

/** Key pair in `settings` (`push.vapid`); excluded from JSON backups (see `BackupService`). */
export const VAPID_SETTING_KEY = 'push.vapid';
const vapidKeysSchema = z.object({ publicKey: z.string().min(1), privateKey: z.string().min(1) });
type VapidKeys = z.infer<typeof vapidKeysSchema>;

const DEFAULT_TIMEOUT_MS = 10_000;
/** The push service's `Topic` header: ≤ 32 URL-safe characters; a pending message of the same topic is replaced. */
const topicOf = (tag: string) => tag.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32);

type SubscriptionRow = typeof pushSubscriptions.$inferSelect;

export function toSubscriptionInfo(row: SubscriptionRow): PushSubscriptionInfo {
  return {
    id: row.id,
    endpoint: row.endpoint,
    deviceLabel: row.deviceLabel,
    timezone: row.timezone,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    failures: row.failures,
  };
}

/** The endpoint's host is enough for logs; the path is the capability. */
function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid';
  }
}

/**
 * Web Push delivery (FR-N2, FR-N3): the VAPID key pair (generated on first use, kept in
 * `settings`), the per-device subscriptions and sending through the browsers' push services with
 * the house-keeping the protocol asks for (404/410 → forget the device, other errors → count).
 */
export class PushService {
  private readonly vapid: VapidKeys;
  private readonly timeoutMs: number;
  private readonly logger: PushServiceOptions['logger'];

  constructor(
    private readonly db: Db,
    private readonly options: PushServiceOptions,
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = options.logger;
    this.vapid = this.loadOrCreateVapidKeys();
  }

  /** The `applicationServerKey` browsers subscribe with. */
  publicKey(): string {
    return this.vapid.publicKey;
  }

  list(): PushSubscriptionInfo[] {
    return this.db
      .select()
      .from(pushSubscriptions)
      .orderBy(asc(pushSubscriptions.createdAt), asc(pushSubscriptions.id))
      .all()
      .map(toSubscriptionInfo);
  }

  count(): number {
    const row = this.db
      .select({ n: sql<number>`count(*)` })
      .from(pushSubscriptions)
      .get();
    return row?.n ?? 0;
  }

  /** Upsert by endpoint: re-enabling on a device refreshes its keys and label instead of duplicating it. */
  subscribe(input: PushSubscribeRequest): PushSubscriptionInfo {
    const now = new Date().toISOString();
    const values = {
      endpoint: input.subscription.endpoint,
      p256dh: input.subscription.keys.p256dh,
      auth: input.subscription.keys.auth,
      deviceLabel: input.deviceLabel,
      timezone: input.timezone,
      createdAt: now,
      lastUsedAt: null,
      failures: 0,
    };
    const row = this.db
      .insert(pushSubscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          p256dh: values.p256dh,
          auth: values.auth,
          deviceLabel: values.deviceLabel,
          timezone: values.timezone,
          failures: 0,
        },
      })
      .returning()
      .get();
    return toSubscriptionInfo(row);
  }

  remove(id: number): void {
    const row = this.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, id))
      .get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Device not found');
    this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id)).run();
  }

  /**
   * Encrypts the payload to each device and hands it to its push service. Resolves once every
   * delivery has been attempted; a failing device never blocks the others.
   */
  async send(payload: PushPayload, options: SendOptions): Promise<PushSendResult> {
    const rows =
      options.endpoint === undefined
        ? this.db.select().from(pushSubscriptions).all()
        : this.db
            .select()
            .from(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, options.endpoint))
            .all();
    if (rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'No device is enabled for reminders');
    }

    const body = JSON.stringify(payload);
    const outcomes = await Promise.allSettled(
      rows.map((row) =>
        webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body,
          {
            vapidDetails: {
              subject: this.options.vapidSubject,
              publicKey: this.vapid.publicKey,
              privateKey: this.vapid.privateKey,
            },
            TTL: options.ttlSeconds,
            // Reminders are time-sensitive: "high" asks the device to wake for them rather than
            // batch them into its next maintenance window.
            urgency: 'high',
            topic: topicOf(payload.tag),
            timeout: this.timeoutMs,
          },
        ),
      ),
    );

    const result: PushSendResult = { sent: 0, failed: 0, removed: 0 };
    const now = new Date().toISOString();
    rows.forEach((row, i) => {
      const outcome = outcomes[i]!;
      if (outcome.status === 'fulfilled') {
        result.sent += 1;
        this.db
          .update(pushSubscriptions)
          .set({ lastUsedAt: now, failures: 0 })
          .where(eq(pushSubscriptions.id, row.id))
          .run();
        return;
      }
      const statusCode = statusCodeOf(outcome.reason);
      const host = endpointHost(row.endpoint);
      if (statusCode === 404 || statusCode === 410) {
        result.removed += 1;
        this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id)).run();
        this.logger?.info(
          { id: row.id, host, statusCode },
          'push subscription gone; removed the device',
        );
        return;
      }
      result.failed += 1;
      this.db
        .update(pushSubscriptions)
        .set({ failures: sql`${pushSubscriptions.failures} + 1` })
        .where(eq(pushSubscriptions.id, row.id))
        .run();
      this.logger?.warn(
        { id: row.id, host, statusCode, err: messageOf(outcome.reason) },
        'push delivery failed',
      );
    });
    return result;
  }

  private loadOrCreateVapidKeys(): VapidKeys {
    const row = this.db
      .select({ valueJson: settings.valueJson })
      .from(settings)
      .where(eq(settings.key, VAPID_SETTING_KEY))
      .get();
    if (row) {
      const parsed = vapidKeysSchema.safeParse(parseJson(row.valueJson));
      if (parsed.success) return parsed.data;
      this.logger?.warn({}, 'stored VAPID keys are unreadable; generating a new pair');
    }
    const keys = webpush.generateVAPIDKeys();
    const now = new Date().toISOString();
    this.db
      .insert(settings)
      .values({ key: VAPID_SETTING_KEY, valueJson: JSON.stringify(keys), updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { valueJson: JSON.stringify(keys), updatedAt: now },
      })
      .run();
    this.logger?.info({}, 'generated VAPID keys for web push');
    return keys;
  }
}

function statusCodeOf(reason: unknown): number | undefined {
  if (typeof reason === 'object' && reason !== null && 'statusCode' in reason) {
    const { statusCode } = reason;
    return typeof statusCode === 'number' ? statusCode : undefined;
  }
  return undefined;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
