CREATE TABLE `project_preview_approvals` (
	`project_id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`preview_set_id` text,
	`selected_preview_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`approved_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_project_preview_approvals_owner` ON `project_preview_approvals` (`owner_user_id`,`updated_at`);