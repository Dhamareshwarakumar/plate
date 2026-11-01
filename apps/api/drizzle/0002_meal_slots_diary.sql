CREATE TABLE `diary_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`slot_id` integer NOT NULL,
	`logged_at` text NOT NULL,
	`food_id` integer,
	`name_snapshot` text NOT NULL,
	`quantity` real NOT NULL,
	`basis` text DEFAULT 'g' NOT NULL,
	`portion_label` text,
	`portion_count` real,
	`note` text,
	`kcal_100` real NOT NULL,
	`protein_100` real NOT NULL,
	`carbs_100` real NOT NULL,
	`fat_100` real NOT NULL,
	`fiber_100` real,
	`sugar_100` real,
	`saturated_fat_100` real,
	`sodium_mg_100` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`slot_id`) REFERENCES `meal_slots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `diary_entries_day_idx` ON `diary_entries` (`day`);--> statement-breakpoint
CREATE INDEX `diary_entries_food_id_idx` ON `diary_entries` (`food_id`);--> statement-breakpoint
CREATE INDEX `diary_entries_day_slot_idx` ON `diary_entries` (`day`,`slot_id`);--> statement-breakpoint
CREATE INDEX `diary_entries_logged_at_idx` ON `diary_entries` (`logged_at`);--> statement-breakpoint
CREATE TABLE `meal_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`window_start_min` integer NOT NULL,
	`window_end_min` integer NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `meal_slots_sort_order_idx` ON `meal_slots` (`sort_order`);