CREATE TABLE "remark_cable_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"remark_id" uuid NOT NULL,
	"cable_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cable_list_items" ADD COLUMN "is_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cable_list_items" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cable_list_items" ADD COLUMN "completed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD COLUMN "task_code" text;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD COLUMN "parent_list_id" uuid;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD COLUMN "deadline" date;--> statement-breakpoint
ALTER TABLE "remarks" ADD COLUMN "stage" "priority_list_kanban_status";--> statement-breakpoint
ALTER TABLE "task_events" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "task_events" ADD COLUMN "reverted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_events" ADD COLUMN "reverted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "remark_cable_items" ADD CONSTRAINT "remark_cable_items_remark_id_remarks_id_fk" FOREIGN KEY ("remark_id") REFERENCES "public"."remarks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remark_cable_items" ADD CONSTRAINT "remark_cable_items_cable_id_cables_id_fk" FOREIGN KEY ("cable_id") REFERENCES "public"."cables"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "remark_cable_items_cable_idx" ON "remark_cable_items" USING btree ("cable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "remark_cable_items_remark_cable_unique" ON "remark_cable_items" USING btree ("remark_id","cable_id");--> statement-breakpoint
ALTER TABLE "cable_list_items" ADD CONSTRAINT "cable_list_items_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_room_lists" ADD CONSTRAINT "priority_room_lists_parent_list_id_priority_room_lists_id_fk" FOREIGN KEY ("parent_list_id") REFERENCES "public"."priority_room_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_reverted_by_user_id_users_id_fk" FOREIGN KEY ("reverted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;