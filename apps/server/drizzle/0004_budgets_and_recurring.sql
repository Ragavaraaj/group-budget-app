CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`category_id` text,
	`amount_minor` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `budgets_group_seq_idx` ON `budgets` (`group_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `recurring_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`frequency` text NOT NULL,
	`start_on` text NOT NULL,
	`end_on` text,
	`active` integer DEFAULT true NOT NULL,
	`amount_minor` integer NOT NULL,
	`category_id` text,
	`note` text DEFAULT '' NOT NULL,
	`split_type` text NOT NULL,
	`payers` text NOT NULL,
	`shares` text NOT NULL,
	`created_by` text NOT NULL,
	`last_generated_on` text,
	`next_due_on` text,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recurring_group_seq_idx` ON `recurring_rules` (`group_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `recurring_due_idx` ON `recurring_rules` (`next_due_on`);