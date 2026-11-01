CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`effective_from` text NOT NULL,
	`kcal` real NOT NULL,
	`protein_g` real NOT NULL,
	`carbs_g` real NOT NULL,
	`fat_g` real NOT NULL,
	`fiber_g` real,
	`water_ml` real,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goals_effective_from_unique` ON `goals` (`effective_from`);--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`sex` text NOT NULL,
	`birth_date` text NOT NULL,
	`height_cm` real NOT NULL,
	`activity` text NOT NULL
);
