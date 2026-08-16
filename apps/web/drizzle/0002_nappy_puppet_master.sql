CREATE TABLE `runner_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`instance_id` text NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`rotate_requested_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
