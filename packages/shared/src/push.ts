import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './foods.js';
import { timeZoneSchema } from './reminders.js';
import { trimmed } from './zod-helpers.js';

// ---------- Web Push subscriptions (FR-N2, FR-N3) ----------

export const PUSH_DEVICE_LABEL_MAX = 80;
export const PUSH_ENDPOINT_MAX = 2048;

/** `PushSubscription.toJSON()` as the browser produces it. Push services are HTTPS only. */
export const pushSubscriptionJsonSchema = z.object({
  endpoint: z
    .url({ protocol: /^https$/, error: 'Endpoint must be an https URL' })
    .max(PUSH_ENDPOINT_MAX),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});
export type PushSubscriptionJson = z.infer<typeof pushSubscriptionJsonSchema>;

/** `POST push/subscriptions`: enable reminders on the calling device. */
export const pushSubscribeRequestSchema = z.object({
  subscription: pushSubscriptionJsonSchema,
  /** "Chrome on Android"; derived by the client from its user agent. */
  deviceLabel: trimmed(PUSH_DEVICE_LABEL_MAX, 'Device label'),
  timezone: timeZoneSchema,
});
export type PushSubscribeRequest = z.infer<typeof pushSubscribeRequestSchema>;

/** A device in the list. The keys stay on the server; the endpoint lets a device recognise itself. */
export const pushSubscriptionInfoSchema = z.object({
  id: idSchema,
  endpoint: z.string(),
  deviceLabel: z.string(),
  timezone: z.string(),
  createdAt: isoDateTimeSchema,
  /** Last successful delivery; null until the first one. */
  lastUsedAt: isoDateTimeSchema.nullable(),
  /** Consecutive failed deliveries (reset on success). 404/410 remove the row instead. */
  failures: z.number().int().nonnegative(),
});
export type PushSubscriptionInfo = z.infer<typeof pushSubscriptionInfoSchema>;

export const vapidPublicKeyResponseSchema = z.object({ publicKey: z.string() });
export type VapidPublicKeyResponse = z.infer<typeof vapidPublicKeyResponseSchema>;

/** `POST push/test`: to one device (its endpoint) or, without a body, to every device. */
export const pushTestRequestSchema = z.object({
  endpoint: z.string().max(PUSH_ENDPOINT_MAX).optional(),
});
export type PushTestRequest = z.infer<typeof pushTestRequestSchema>;

export const pushSendResultSchema = z.object({
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Subscriptions the push service reported gone (404/410) and that were deleted. */
  removed: z.number().int().nonnegative(),
});
export type PushSendResult = z.infer<typeof pushSendResultSchema>;

/**
 * What travels through the push service, encrypted to the device: generic wording only, never
 * nutrition data (FR-N3). The service worker shows it as-is and opens `url` on tap.
 */
export const pushPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  /** Notification tag; a later reminder with the same tag replaces the earlier one. */
  tag: z.string(),
  /** In-app path to open on tap. */
  url: z.string(),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;
