CREATE TYPE "public"."graph_side" AS ENUM('dirty', 'clean');--> statement-breakpoint
CREATE TYPE "public"."graph_subzone" AS ENUM('dirty', 'clean');--> statement-breakpoint
CREATE TYPE "public"."installation_kks_item_type" AS ENUM('mechanism', 'cable');--> statement-breakpoint
CREATE TYPE "public"."installation_pending_status" AS ENUM('pending', 'applied', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."priority_room_kanban_status" AS ENUM('in_progress', 'done', 'checked');--> statement-breakpoint
CREATE TYPE "public"."graph_room_role" AS ENUM('primary', 'secondary');--> statement-breakpoint
CREATE TYPE "public"."snapshot_kind" AS ENUM('demolition', 'installation');--> statement-breakpoint
CREATE TYPE "public"."snapshot_source_type" AS ENUM('ods', 'xlsx', 'xls');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin', 'super-admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'rejected');--> statement-breakpoint
CREATE TABLE "cable_change_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid,
	"group_id" uuid,
	"room_id" uuid,
	"cable_row_id" uuid,
	"room_name" text NOT NULL,
	"cable_label" text NOT NULL,
	"shaft" integer DEFAULT 0 NOT NULL,
	"user_id" uuid NOT NULL,
	"user_login" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_date" date NOT NULL,
	"is_backdated" boolean DEFAULT false NOT NULL,
	"old_progress" integer NOT NULL,
	"new_progress" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cable_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"cable_row_id" uuid NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"effective_date" date,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid,
	"group_id" uuid,
	"room_id" uuid,
	"room_name" text NOT NULL,
	"user_id" uuid NOT NULL,
	"user_login" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_date" date NOT NULL,
	"is_backdated" boolean DEFAULT false NOT NULL,
	"old_progress" integer NOT NULL,
	"new_progress" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_group_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"room_name" text NOT NULL,
	"room_role" "graph_room_role" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"cable_count" integer DEFAULT 0 NOT NULL,
	"thread_count" integer DEFAULT 0 NOT NULL,
	"total_length" double precision DEFAULT 0 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"effective_date" date,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"group_key" text NOT NULL,
	"graph_side" "graph_side" NOT NULL,
	"graph_subzone" "graph_subzone",
	"source_zone" text DEFAULT '' NOT NULL,
	"level" text NOT NULL,
	"level_order" double precision DEFAULT 0 NOT NULL,
	"primary_rooms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secondary_rooms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cable_count" integer DEFAULT 0 NOT NULL,
	"thread_count" integer DEFAULT 0 NOT NULL,
	"total_length" double precision DEFAULT 0 NOT NULL,
	"no_shaft_threads" integer DEFAULT 0 NOT NULL,
	"shaft1_threads" integer DEFAULT 0 NOT NULL,
	"shaft2_threads" integer DEFAULT 0 NOT NULL,
	"shaft3_threads" integer DEFAULT 0 NOT NULL,
	"shaft4_threads" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_kind" "snapshot_kind" DEFAULT 'demolition' NOT NULL,
	"file_name" text NOT NULL,
	"file_type" "snapshot_source_type" NOT NULL,
	"checksum" text NOT NULL,
	"imported_by_user_id" uuid NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"summary" jsonb DEFAULT '{"levels":[],"sides":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imported_cable_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"source_row_index" integer NOT NULL,
	"cable_label" text NOT NULL,
	"cable_journal" text DEFAULT '' NOT NULL,
	"cable_number" text DEFAULT '' NOT NULL,
	"repeat_from" text DEFAULT '' NOT NULL,
	"repeat_to" text DEFAULT '' NOT NULL,
	"repeat_kks" text DEFAULT '' NOT NULL,
	"from_room" text DEFAULT '' NOT NULL,
	"from_location" text DEFAULT '' NOT NULL,
	"from_equipment" text DEFAULT '' NOT NULL,
	"to_room" text DEFAULT '' NOT NULL,
	"thread_length" double precision DEFAULT 0 NOT NULL,
	"thread_count" integer DEFAULT 0 NOT NULL,
	"total_length" double precision DEFAULT 0 NOT NULL,
	"level" text DEFAULT '' NOT NULL,
	"level_order" double precision DEFAULT 0 NOT NULL,
	"from_zone" text DEFAULT '' NOT NULL,
	"to_zone" text DEFAULT '' NOT NULL,
	"graph_side" "graph_side" NOT NULL,
	"graph_subzone" "graph_subzone",
	"farthest_shaft" integer,
	"shaft_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"route" text DEFAULT '' NOT NULL,
	"raw_row" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installation_kks_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_sheet" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"kks_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installation_kks_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"item_type" "installation_kks_item_type" DEFAULT 'cable' NOT NULL,
	"source_sheet" text DEFAULT '' NOT NULL,
	"source_row_index" integer DEFAULT 0 NOT NULL,
	"source_column_index" integer DEFAULT 0 NOT NULL,
	"source_column_label" text DEFAULT '' NOT NULL,
	"matched_in_cable_base" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installation_pending_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_mutation_id" text NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"kks_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"user_login" text NOT NULL,
	"base_done" boolean NOT NULL,
	"desired_done" boolean NOT NULL,
	"server_done" boolean NOT NULL,
	"has_conflict" boolean DEFAULT false NOT NULL,
	"resolved_done" boolean,
	"status" "installation_pending_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"file_type" "snapshot_source_type" NOT NULL,
	"checksum" text NOT NULL,
	"imported_by_user_id" uuid NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"summary" jsonb DEFAULT '{"groupCount":0,"kksCount":0}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_graph_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_name" text NOT NULL,
	"source_zone" text NOT NULL,
	"level" text NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "priority_room_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"room_name" text NOT NULL,
	"normalized_room_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "priority_room_kanban_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"status" "priority_room_kanban_status" DEFAULT 'in_progress' NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"checked_by_user_id" uuid,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "priority_room_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"room_count" integer DEFAULT 0 NOT NULL,
	"imported_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cable_change_audit_logs" ADD CONSTRAINT "cable_change_audit_logs_snapshot_id_import_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."import_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_change_audit_logs" ADD CONSTRAINT "cable_change_audit_logs_group_id_graph_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."graph_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_change_audit_logs" ADD CONSTRAINT "cable_change_audit_logs_room_id_graph_group_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."graph_group_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_change_audit_logs" ADD CONSTRAINT "cable_change_audit_logs_cable_row_id_imported_cable_rows_id_fk" FOREIGN KEY ("cable_row_id") REFERENCES "public"."imported_cable_rows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_change_audit_logs" ADD CONSTRAINT "cable_change_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_progress" ADD CONSTRAINT "cable_progress_snapshot_id_import_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."import_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_progress" ADD CONSTRAINT "cable_progress_group_id_graph_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."graph_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_progress" ADD CONSTRAINT "cable_progress_room_id_graph_group_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."graph_group_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_progress" ADD CONSTRAINT "cable_progress_cable_row_id_imported_cable_rows_id_fk" FOREIGN KEY ("cable_row_id") REFERENCES "public"."imported_cable_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_progress" ADD CONSTRAINT "cable_progress_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_audit_logs" ADD CONSTRAINT "change_audit_logs_snapshot_id_import_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."import_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_audit_logs" ADD CONSTRAINT "change_audit_logs_group_id_graph_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."graph_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_audit_logs" ADD CONSTRAINT "change_audit_logs_room_id_graph_group_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."graph_group_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_audit_logs" ADD CONSTRAINT "change_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_group_rooms" ADD CONSTRAINT "graph_group_rooms_snapshot_id_import_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."import_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_group_rooms" ADD CONSTRAINT "graph_group_rooms_group_id_graph_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."graph_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_group_rooms" ADD CONSTRAINT "graph_group_rooms_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_groups" ADD CONSTRAINT "graph_groups_snapshot_id_import_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."import_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_snapshots" ADD CONSTRAINT "import_snapshots_imported_by_user_id_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_cable_rows" ADD CONSTRAINT "imported_cable_rows_snapshot_id_import_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."import_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_kks_groups" ADD CONSTRAINT "installation_kks_groups_snapshot_id_installation_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."installation_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_kks_items" ADD CONSTRAINT "installation_kks_items_snapshot_id_installation_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."installation_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_kks_items" ADD CONSTRAINT "installation_kks_items_group_id_installation_kks_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."installation_kks_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_kks_items" ADD CONSTRAINT "installation_kks_items_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_pending_changes" ADD CONSTRAINT "installation_pending_changes_snapshot_id_installation_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."installation_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_pending_changes" ADD CONSTRAINT "installation_pending_changes_group_id_installation_kks_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."installation_kks_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_pending_changes" ADD CONSTRAINT "installation_pending_changes_kks_item_id_installation_kks_items_id_fk" FOREIGN KEY ("kks_item_id") REFERENCES "public"."installation_kks_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_pending_changes" ADD CONSTRAINT "installation_pending_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_snapshots" ADD CONSTRAINT "installation_snapshots_imported_by_user_id_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_graph_rooms" ADD CONSTRAINT "manual_graph_rooms_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_room_entries" ADD CONSTRAINT "priority_room_entries_list_id_priority_room_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."priority_room_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_room_entries" ADD CONSTRAINT "priority_room_entries_snapshot_id_import_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."import_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_room_kanban_states" ADD CONSTRAINT "priority_room_kanban_states_snapshot_id_import_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."import_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_room_kanban_states" ADD CONSTRAINT "priority_room_kanban_states_room_id_graph_group_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."graph_group_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_room_kanban_states" ADD CONSTRAINT "priority_room_kanban_states_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_room_kanban_states" ADD CONSTRAINT "priority_room_kanban_states_checked_by_user_id_users_id_fk" FOREIGN KEY ("checked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD CONSTRAINT "priority_room_lists_snapshot_id_import_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."import_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD CONSTRAINT "priority_room_lists_imported_by_user_id_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cable_change_audit_logs_changed_at_idx" ON "cable_change_audit_logs" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "cable_change_audit_logs_effective_date_idx" ON "cable_change_audit_logs" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "cable_change_audit_logs_backdated_effective_changed_idx" ON "cable_change_audit_logs" USING btree ("is_backdated","effective_date","changed_at");--> statement-breakpoint
CREATE INDEX "cable_change_audit_logs_cable_row_idx" ON "cable_change_audit_logs" USING btree ("cable_row_id");--> statement-breakpoint
CREATE INDEX "cable_progress_snapshot_room_idx" ON "cable_progress" USING btree ("snapshot_id","room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cable_progress_snapshot_cable_unique" ON "cable_progress" USING btree ("snapshot_id","cable_row_id");--> statement-breakpoint
CREATE INDEX "change_audit_logs_changed_at_idx" ON "change_audit_logs" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "change_audit_logs_effective_date_idx" ON "change_audit_logs" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "change_audit_logs_backdated_effective_changed_idx" ON "change_audit_logs" USING btree ("is_backdated","effective_date","changed_at");--> statement-breakpoint
CREATE INDEX "graph_group_rooms_snapshot_group_sort_idx" ON "graph_group_rooms" USING btree ("snapshot_id","group_id","room_role","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_group_rooms_unique" ON "graph_group_rooms" USING btree ("group_id","room_role","room_name");--> statement-breakpoint
CREATE INDEX "graph_groups_snapshot_sort_idx" ON "graph_groups" USING btree ("snapshot_id","level_order","graph_side","source_zone");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_groups_snapshot_group_key_unique" ON "graph_groups" USING btree ("snapshot_id","group_key");--> statement-breakpoint
CREATE INDEX "import_snapshots_kind_active_idx" ON "import_snapshots" USING btree ("snapshot_kind","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "import_snapshots_kind_single_active_unique" ON "import_snapshots" USING btree ("snapshot_kind","is_active") WHERE "import_snapshots"."is_active" = true;--> statement-breakpoint
CREATE INDEX "imported_cable_rows_snapshot_id_idx" ON "imported_cable_rows" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "installation_kks_groups_snapshot_sort_idx" ON "installation_kks_groups" USING btree ("snapshot_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "installation_kks_groups_snapshot_name_unique" ON "installation_kks_groups" USING btree ("snapshot_id","name");--> statement-breakpoint
CREATE INDEX "installation_kks_items_snapshot_group_sort_idx" ON "installation_kks_items" USING btree ("snapshot_id","group_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "installation_kks_items_group_name_unique" ON "installation_kks_items" USING btree ("group_id","name");--> statement-breakpoint
CREATE INDEX "installation_pending_changes_status_group_idx" ON "installation_pending_changes" USING btree ("status","group_id");--> statement-breakpoint
CREATE INDEX "installation_pending_changes_snapshot_status_idx" ON "installation_pending_changes" USING btree ("snapshot_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "installation_pending_changes_client_mutation_unique" ON "installation_pending_changes" USING btree ("client_mutation_id");--> statement-breakpoint
CREATE INDEX "installation_snapshots_active_idx" ON "installation_snapshots" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "installation_snapshots_single_active_unique" ON "installation_snapshots" USING btree ("is_active") WHERE "installation_snapshots"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "manual_graph_rooms_unique" ON "manual_graph_rooms" USING btree ("source_zone","level","room_name");--> statement-breakpoint
CREATE INDEX "priority_room_entries_snapshot_room_idx" ON "priority_room_entries" USING btree ("snapshot_id","normalized_room_name");--> statement-breakpoint
CREATE UNIQUE INDEX "priority_room_entries_list_room_unique" ON "priority_room_entries" USING btree ("list_id","normalized_room_name");--> statement-breakpoint
CREATE INDEX "priority_room_kanban_states_snapshot_status_idx" ON "priority_room_kanban_states" USING btree ("snapshot_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "priority_room_kanban_states_snapshot_room_unique" ON "priority_room_kanban_states" USING btree ("snapshot_id","room_id");--> statement-breakpoint
CREATE INDEX "priority_room_lists_snapshot_created_idx" ON "priority_room_lists" USING btree ("snapshot_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_login_unique" ON "users" USING btree ("login");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");