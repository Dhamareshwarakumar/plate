CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`device_label` text NOT NULL,
	`timezone` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`failures` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `reminder_sends` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reminder_key` text NOT NULL,
	`day` text NOT NULL,
	`sent_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_sends_key_day_unique` ON `reminder_sends` (`reminder_key`,`day`);