CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `categories_sort_order_idx` ON `categories` (`sort_order`);--> statement-breakpoint
CREATE TABLE `foods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'food' NOT NULL,
	`name` text NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`category_id` integer,
	`basis` text DEFAULT 'g' NOT NULL,
	`kcal` real NOT NULL,
	`protein` real NOT NULL,
	`carbs` real NOT NULL,
	`fat` real NOT NULL,
	`fiber` real,
	`sugar` real,
	`saturated_fat` real,
	`sodium_mg` real,
	`source` text DEFAULT 'manual' NOT NULL,
	`off_code` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `foods_name_idx` ON `foods` (`name`);--> statement-breakpoint
CREATE INDEX `foods_category_id_idx` ON `foods` (`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `foods_name_brand_unique` ON `foods` (lower("name"),lower("brand"));--> statement-breakpoint
CREATE TABLE `portions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`food_id` integer NOT NULL,
	`label` text NOT NULL,
	`amount` real NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `portions_food_id_idx` ON `portions` (`food_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `auth` ADD `password_is_initial` integer DEFAULT 1 NOT NULL;