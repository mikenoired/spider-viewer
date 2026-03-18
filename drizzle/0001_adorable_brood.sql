CREATE TYPE "public"."graph_side" AS ENUM('dirty', 'clean');--> statement-breakpoint
CREATE TYPE "public"."graph_subzone" AS ENUM('dirty', 'clean');--> statement-breakpoint
CREATE TYPE "public"."graph_room_role" AS ENUM('primary', 'secondary');--> statement-breakpoint
CREATE TYPE "public"."snapshot_source_type" AS ENUM('ods', 'xlsx', 'xls');--> statement-breakpoint
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
CREATE UNIQUE INDEX "graph_group_rooms_unique" ON "graph_group_rooms" USING btree ("group_id","room_role","room_name");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_groups_snapshot_group_key_unique" ON "graph_groups" USING btree ("snapshot_id","group_key");