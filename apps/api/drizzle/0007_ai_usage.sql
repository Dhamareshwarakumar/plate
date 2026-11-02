CREATE TABLE `ai_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feature` text NOT NULL,
	`requested_at` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`ok` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_requested_at_idx` ON `ai_usage` (`requested_at`);--> statement-breakpoint
ALTER TABLE `foods` ADD `estimated_at` text;