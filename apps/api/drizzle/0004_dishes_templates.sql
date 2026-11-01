CREATE TABLE `dish_ingredients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dish_food_id` integer NOT NULL,
	`ingredient_food_id` integer NOT NULL,
	`amount` real NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`dish_food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dish_ingredients_dish_food_id_idx` ON `dish_ingredients` (`dish_food_id`);--> statement-breakpoint
CREATE INDEX `dish_ingredients_ingredient_food_id_idx` ON `dish_ingredients` (`ingredient_food_id`);--> statement-breakpoint
CREATE TABLE `meal_template_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`food_id` integer NOT NULL,
	`amount` real NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `meal_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `meal_template_items_template_id_idx` ON `meal_template_items` (`template_id`);--> statement-breakpoint
CREATE INDEX `meal_template_items_food_id_idx` ON `meal_template_items` (`food_id`);--> statement-breakpoint
CREATE TABLE `meal_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `foods` ADD `cooked_weight_g` real;--> statement-breakpoint
ALTER TABLE `foods` ADD `servings` integer;--> statement-breakpoint
ALTER TABLE `foods` ADD `stale_since` text;