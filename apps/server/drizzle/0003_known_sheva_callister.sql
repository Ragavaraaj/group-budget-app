ALTER TABLE `login_attempts` ADD `invite_token` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `removed_by` text REFERENCES users(id);