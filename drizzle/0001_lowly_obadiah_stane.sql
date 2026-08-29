CREATE TYPE "public"."user_department" AS ENUM('tai', 'skm', 'commissioning', 'curator');--> statement-breakpoint
ALTER TYPE "public"."remark_target_type" ADD VALUE IF NOT EXISTS 'cable';--> statement-breakpoint
CREATE TABLE "cables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_key" text NOT NULL,
	"cable_label" text NOT NULL,
	"cable_journal" text DEFAULT '' NOT NULL,
	"cable_number" text DEFAULT '' NOT NULL,
	"from_room" text DEFAULT '' NOT NULL,
	"to_room" text DEFAULT '' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"progress_updated_by_user_id" uuid,
	"progress_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "cable_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"cable_id" uuid NOT NULL,
	"source_row_index" integer DEFAULT 0 NOT NULL,
	"imported_progress" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"message" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"list_id" uuid,
	"remark_id" uuid,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "priority_room_lists" DROP CONSTRAINT "priority_room_lists_snapshot_id_import_snapshots_id_fk";--> statement-breakpoint
ALTER TABLE "priority_room_lists" ALTER COLUMN "snapshot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "imported_cable_rows" ADD COLUMN "cable_id" uuid;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD COLUMN "source_checksum" text;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD COLUMN "sender_department" "user_department" DEFAULT 'tai' NOT NULL;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD COLUMN "recipient_department" "user_department";--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD COLUMN "responsible_user_id" uuid;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "remarks" ADD COLUMN "list_id" uuid;--> statement-breakpoint
ALTER TABLE "remarks" ADD COLUMN "assigned_department" "user_department";--> statement-breakpoint
ALTER TABLE "remarks" ADD COLUMN "assigned_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "department" "user_department" DEFAULT 'tai' NOT NULL;--> statement-breakpoint
ALTER TABLE "cables" ADD CONSTRAINT "cables_progress_updated_by_user_id_users_id_fk" FOREIGN KEY ("progress_updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "imported_cable_rows" ADD CONSTRAINT "imported_cable_rows_cable_id_cables_id_fk" FOREIGN KEY ("cable_id") REFERENCES "public"."cables"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD CONSTRAINT "priority_room_lists_snapshot_id_import_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."import_snapshots"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD CONSTRAINT "priority_room_lists_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "cable_list_items" ADD CONSTRAINT "cable_list_items_list_id_priority_room_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."priority_room_lists"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "cable_list_items" ADD CONSTRAINT "cable_list_items_cable_id_cables_id_fk" FOREIGN KEY ("cable_id") REFERENCES "public"."cables"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_list_id_priority_room_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."priority_room_lists"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_list_id_priority_room_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."priority_room_lists"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_list_id_priority_room_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."priority_room_lists"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "remarks" ADD CONSTRAINT "remarks_list_id_priority_room_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."priority_room_lists"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "remarks" ADD CONSTRAINT "remarks_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX "cables_external_key_unique" ON "cables" USING btree ("external_key");--> statement-breakpoint
CREATE INDEX "cables_label_idx" ON "cables" USING btree ("cable_label");--> statement-breakpoint
CREATE INDEX "cable_list_items_list_idx" ON "cable_list_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "cable_list_items_cable_idx" ON "cable_list_items" USING btree ("cable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cable_list_items_list_cable_unique" ON "cable_list_items" USING btree ("list_id", "cable_id");--> statement-breakpoint
CREATE INDEX "task_comments_list_created_idx" ON "task_comments" USING btree ("list_id", "created_at");--> statement-breakpoint
CREATE INDEX "task_events_list_created_idx" ON "task_events" USING btree ("list_id", "created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_unique" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "priority_room_lists_status_created_idx" ON "priority_room_lists" USING btree ("status", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "priority_room_lists_source_checksum_unique" ON "priority_room_lists" USING btree ("source_checksum");
