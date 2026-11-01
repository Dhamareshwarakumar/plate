CREATE TABLE `water_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`ml` integer NOT NULL,
	`logged_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `water_entries_day_idx` ON `water_entries` (`day`);--> statement-breakpoint
CREATE TABLE `weights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`kg` real NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weights_day_unique` ON `weights` (`day`);--> statement-breakpoint
ALTER TABLE `goals` ADD `goal_weight_kg` real;--> statement-breakpoint
ALTER TABLE `goals` ADD `goal_weight_date` text;