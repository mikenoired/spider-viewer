#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import postgres from "postgres";

function loadLocalEnvFile(filePath = ".env") {
	if (!existsSync(filePath)) return;

	const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

	for (const line of lines) {
		const trimmedLine = line.trim();

		if (!trimmedLine || trimmedLine.startsWith("#")) continue;

		const match = /^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/.exec(trimmedLine);

		if (!match) continue;

		const [, key, rawValue] = match;

		if (process.env[key] !== undefined) continue;

		process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
	}
}

loadLocalEnvFile();

const requiredEnvironmentVariables = ["DATABASE_URL", "AUTH_SUPERUSERS_JSON"];

const enumDefinitions = [
	["user_role", ["user", "admin", "super-admin"]],
	["user_status", ["pending", "active", "rejected"]],
	["user_department", ["tai", "skm", "commissioning", "curator"]],
	["snapshot_source_type", ["ods", "xlsx", "xls"]],
	["snapshot_kind", ["demolition", "installation"]],
	["graph_side", ["dirty", "clean"]],
	["graph_subzone", ["dirty", "clean"]],
	["graph_room_role", ["primary", "secondary"]],
	["installation_pending_status", ["pending", "applied", "discarded"]],
	["installation_kks_item_type", ["mechanism", "cable"]],
	["priority_room_kanban_status", ["in_progress", "done", "checked"]],
	["priority_list_kanban_status", ["formed", "in_progress", "curator_review", "adjustment", "done"]],
	["remark_target_type", ["cable_change", "room_change", "priority_list", "cable"]],
	["remark_status", ["open", "resolved"]],
];

const tableDefinitions = [
	[
		"users",
		`create table if not exists users (
			id uuid primary key default gen_random_uuid(),
			login text not null,
			password_hash text not null,
			role user_role not null default 'user',
			department user_department not null default 'tai',
			status user_status not null default 'active',
			reviewed_by_user_id uuid,
			reviewed_at timestamp with time zone,
			created_at timestamp with time zone not null default now(),
			updated_at timestamp with time zone not null default now()
		)`,
	],
	[
		"import_snapshots",
		`create table if not exists import_snapshots (
			id uuid primary key default gen_random_uuid(),
			snapshot_kind snapshot_kind not null default 'demolition',
			file_name text not null,
			file_type snapshot_source_type not null,
			checksum text not null,
			imported_by_user_id uuid not null,
			row_count integer not null default 0,
			is_active boolean not null default false,
			summary jsonb not null default '{"levels":[],"sides":[]}'::jsonb,
			created_at timestamp with time zone not null default now(),
			updated_at timestamp with time zone not null default now()
		)`,
	],
	[
		"cables",
		`create table if not exists cables (
			id uuid primary key default gen_random_uuid(),
			external_key text not null,
			cable_label text not null,
			cable_journal text not null default '',
			cable_number text not null default '',
			from_room text not null default '',
			to_room text not null default '',
			progress integer not null default 0,
			progress_updated_by_user_id uuid,
			progress_updated_at timestamp with time zone,
			created_at timestamp with time zone not null default now(),
			updated_at timestamp with time zone not null default now()
		)`,
	],
	[
		"imported_cable_rows",
		`create table if not exists imported_cable_rows (
			id uuid primary key default gen_random_uuid(),
			snapshot_id uuid not null,
			cable_id uuid,
			source_row_index integer not null default 0,
			cable_label text not null,
			cable_journal text not null default '',
			cable_number text not null default '',
			repeat_from text not null default '',
			repeat_to text not null default '',
			repeat_kks text not null default '',
			from_room text not null default '',
			from_location text not null default '',
			from_equipment text not null default '',
			to_room text not null default '',
			thread_length double precision not null default 0,
			thread_count integer not null default 0,
			total_length double precision not null default 0,
			level text not null default '',
			level_order double precision not null default 0,
			from_zone text not null default '',
			to_zone text not null default '',
			graph_side graph_side not null,
			graph_subzone graph_subzone,
			farthest_shaft integer,
			shaft_values jsonb not null default '[]'::jsonb,
			route text not null default '',
			raw_row jsonb not null default '[]'::jsonb,
			created_at timestamp with time zone not null default now()
		)`,
	],
	[
		"graph_groups",
		`create table if not exists graph_groups (
			id uuid primary key default gen_random_uuid(),
			snapshot_id uuid not null,
			group_key text not null,
			graph_side graph_side not null,
			graph_subzone graph_subzone,
			source_zone text not null default '',
			level text not null,
			level_order double precision not null default 0,
			primary_rooms jsonb not null default '[]'::jsonb,
			secondary_rooms jsonb not null default '[]'::jsonb,
			cable_count integer not null default 0,
			thread_count integer not null default 0,
			total_length double precision not null default 0,
			no_shaft_threads integer not null default 0,
			shaft1_threads integer not null default 0,
			shaft2_threads integer not null default 0,
			shaft3_threads integer not null default 0,
			shaft4_threads integer not null default 0,
			created_at timestamp with time zone not null default now()
		)`,
	],
	[
		"graph_group_rooms",
		`create table if not exists graph_group_rooms (
			id uuid primary key default gen_random_uuid(),
			snapshot_id uuid not null,
			group_id uuid not null,
			room_name text not null,
			room_role graph_room_role not null,
			sort_order integer not null default 0,
			cable_count integer not null default 0,
			thread_count integer not null default 0,
			total_length double precision not null default 0,
			progress integer not null default 0,
			effective_date date,
			updated_by_user_id uuid,
			updated_at timestamp with time zone not null default now(),
			created_at timestamp with time zone not null default now()
		)`,
	],
	[
		"cable_progress",
		`create table if not exists cable_progress (
			id uuid primary key default gen_random_uuid(),
			snapshot_id uuid not null,
			group_id uuid not null,
			room_id uuid not null,
			cable_row_id uuid not null,
			progress integer not null default 0,
			effective_date date,
			updated_by_user_id uuid,
			updated_at timestamp with time zone not null default now(),
			created_at timestamp with time zone not null default now()
		)`,
	],
	[
		"manual_graph_rooms",
		`create table if not exists manual_graph_rooms (
			id uuid primary key default gen_random_uuid(),
			room_name text not null,
			source_zone text not null,
			level text not null,
			created_by_user_id uuid,
			updated_at timestamp with time zone not null default now(),
			created_at timestamp with time zone not null default now()
		)`,
	],
	[
		"installation_snapshots",
		`create table if not exists installation_snapshots (
			id uuid primary key default gen_random_uuid(),
			file_name text not null,
			file_type snapshot_source_type not null,
			checksum text not null,
			imported_by_user_id uuid not null,
			row_count integer not null default 0,
			is_active boolean not null default false,
			summary jsonb not null default '{"groupCount":0,"kksCount":0}'::jsonb,
			created_at timestamp with time zone not null default now(),
			updated_at timestamp with time zone not null default now()
		)`,
	],
	[
		"installation_kks_groups",
		`create table if not exists installation_kks_groups (
			id uuid primary key default gen_random_uuid(),
			snapshot_id uuid not null,
			name text not null,
			source_sheet text not null default '',
			sort_order integer not null default 0,
			kks_count integer not null default 0,
			created_at timestamp with time zone not null default now()
		)`,
	],
	[
		"installation_kks_items",
		`create table if not exists installation_kks_items (
			id uuid primary key default gen_random_uuid(),
			snapshot_id uuid not null,
			group_id uuid not null,
			name text not null,
			item_type installation_kks_item_type not null default 'cable',
			source_sheet text not null default '',
			source_row_index integer not null default 0,
			source_column_index integer not null default 0,
			source_column_label text not null default '',
			matched_in_cable_base boolean not null default false,
			sort_order integer not null default 0,
			is_done boolean not null default false,
			revision integer not null default 1,
			updated_by_user_id uuid,
			updated_at timestamp with time zone not null default now(),
			created_at timestamp with time zone not null default now()
		)`,
	],
	[
		"installation_pending_changes",
		`create table if not exists installation_pending_changes (
			id uuid primary key default gen_random_uuid(),
			client_mutation_id text not null,
			snapshot_id uuid not null,
			group_id uuid not null,
			kks_item_id uuid not null,
			user_id uuid not null,
			user_login text not null,
			base_done boolean not null,
			desired_done boolean not null,
			server_done boolean not null,
			has_conflict boolean not null default false,
			resolved_done boolean,
			status installation_pending_status not null default 'pending',
			created_at timestamp with time zone not null default now(),
			updated_at timestamp with time zone not null default now()
		)`,
	],
	[
		"priority_room_lists",
		`create table if not exists priority_room_lists (
			id uuid primary key default gen_random_uuid(),
			snapshot_id uuid,
			source_checksum text,
			author_name text not null,
			file_name text not null,
			file_type text not null,
			room_count integer not null default 0,
			status priority_list_kanban_status not null default 'formed',
			status_updated_by_user_id uuid,
			status_updated_at timestamp with time zone,
			imported_by_user_id uuid not null,
			sender_department user_department not null default 'tai',
			recipient_department user_department,
			responsible_user_id uuid,
			accepted_at timestamp with time zone,
			completed_at timestamp with time zone,
			verified_at timestamp with time zone,
			created_at timestamp with time zone not null default now(),
			updated_at timestamp with time zone not null default now()
		)`,
	],
	[
		"remarks",
		`create table if not exists remarks (
			id uuid primary key default gen_random_uuid(),
			target_type remark_target_type not null,
			target_id uuid not null,
			list_id uuid,
			assigned_department user_department,
			assigned_user_id uuid,
			content text not null,
			status remark_status not null default 'open',
			created_by_user_id uuid not null,
			resolved_by_user_id uuid,
			resolved_at timestamp with time zone,
			created_at timestamp with time zone not null default now(),
			updated_at timestamp with time zone not null default now()
		)`,
	],
	[
		"cable_list_items",
		`create table if not exists cable_list_items (
			id uuid primary key default gen_random_uuid(),
			list_id uuid not null,
			cable_id uuid not null,
			source_row_index integer not null default 0,
			imported_progress integer,
			created_at timestamp with time zone not null default now()
		)`,
	],
	[
		"task_comments",
		`create table if not exists task_comments (
			id uuid primary key default gen_random_uuid(),
			list_id uuid not null,
			content text not null,
			created_by_user_id uuid not null,
			created_at timestamp with time zone not null default now()
		)`,
	],
	[
		"task_events",
		`create table if not exists task_events (
			id uuid primary key default gen_random_uuid(),
			list_id uuid not null,
			event_type text not null,
			message text not null,
			actor_user_id uuid,
			created_at timestamp with time zone not null default now()
		)`,
	],
	[
		"notifications",
		`create table if not exists notifications (
			id uuid primary key default gen_random_uuid(),
			user_id uuid not null,
			list_id uuid,
			remark_id uuid,
			type text not null,
			message text not null,
			dedupe_key text not null,
			read_at timestamp with time zone,
			created_at timestamp with time zone not null default now()
		)`,
	],
	[
		"priority_room_entries",
		`create table if not exists priority_room_entries (
			id uuid primary key default gen_random_uuid(),
			list_id uuid not null,
			snapshot_id uuid not null,
			room_name text not null,
			normalized_room_name text not null,
			sort_order integer not null default 0,
			created_at timestamp with time zone not null default now()
		)`,
	],
	[
		"priority_room_kanban_states",
		`create table if not exists priority_room_kanban_states (
			id uuid primary key default gen_random_uuid(),
			snapshot_id uuid not null,
			room_id uuid not null,
			status priority_room_kanban_status not null default 'in_progress',
			updated_by_user_id uuid not null,
			checked_by_user_id uuid,
			checked_at timestamp with time zone,
			created_at timestamp with time zone not null default now(),
			updated_at timestamp with time zone not null default now()
		)`,
	],
	[
		"change_audit_logs",
		`create table if not exists change_audit_logs (
			id uuid primary key default gen_random_uuid(),
			snapshot_id uuid,
			group_id uuid,
			room_id uuid,
			room_name text not null,
			user_id uuid not null,
			user_login text not null,
			changed_at timestamp with time zone not null default now(),
			effective_date date not null,
			is_backdated boolean not null default false,
			old_progress integer not null,
			new_progress integer not null,
			created_at timestamp with time zone not null default now()
		)`,
	],
	[
		"cable_change_audit_logs",
		`create table if not exists cable_change_audit_logs (
			id uuid primary key default gen_random_uuid(),
			snapshot_id uuid,
			group_id uuid,
			room_id uuid,
			cable_row_id uuid,
			room_name text not null,
			cable_label text not null,
			shaft integer not null default 0,
			user_id uuid not null,
			user_login text not null,
			changed_at timestamp with time zone not null default now(),
			effective_date date not null,
			is_backdated boolean not null default false,
			old_progress integer not null,
			new_progress integer not null,
			created_at timestamp with time zone not null default now()
		)`,
	],
];

const columnDefinitions = [
	["users", "reviewed_by_user_id uuid"],
	["users", "reviewed_at timestamp with time zone"],
	["users", "status user_status not null default 'active'"],
	["users", "department user_department not null default 'tai'"],
	["users", "updated_at timestamp with time zone not null default now()"],
	["import_snapshots", "snapshot_kind snapshot_kind not null default 'demolition'"],
	["import_snapshots", 'summary jsonb not null default \'{"levels":[],"sides":[]}\'::jsonb'],
	["imported_cable_rows", "cable_journal text not null default ''"],
	["imported_cable_rows", "cable_id uuid"],
	["imported_cable_rows", "cable_number text not null default ''"],
	["imported_cable_rows", "repeat_from text not null default ''"],
	["imported_cable_rows", "repeat_to text not null default ''"],
	["imported_cable_rows", "repeat_kks text not null default ''"],
	["imported_cable_rows", "from_location text not null default ''"],
	["imported_cable_rows", "from_equipment text not null default ''"],
	["imported_cable_rows", "level_order double precision not null default 0"],
	["imported_cable_rows", "graph_subzone graph_subzone"],
	["imported_cable_rows", "farthest_shaft integer"],
	["imported_cable_rows", "shaft_values jsonb not null default '[]'::jsonb"],
	["imported_cable_rows", "route text not null default ''"],
	["graph_groups", "graph_subzone graph_subzone"],
	["graph_groups", "level_order double precision not null default 0"],
	["graph_groups", "no_shaft_threads integer not null default 0"],
	["graph_groups", "shaft1_threads integer not null default 0"],
	["graph_groups", "shaft2_threads integer not null default 0"],
	["graph_groups", "shaft3_threads integer not null default 0"],
	["graph_groups", "shaft4_threads integer not null default 0"],
	["graph_group_rooms", "effective_date date"],
	["graph_group_rooms", "updated_by_user_id uuid"],
	["cable_progress", "effective_date date"],
	["cable_progress", "updated_by_user_id uuid"],
	["manual_graph_rooms", "created_by_user_id uuid"],
	["installation_kks_groups", "source_sheet text not null default ''"],
	["installation_kks_items", "item_type installation_kks_item_type not null default 'cable'"],
	["installation_kks_items", "source_sheet text not null default ''"],
	["installation_kks_items", "source_row_index integer not null default 0"],
	["installation_kks_items", "source_column_index integer not null default 0"],
	["installation_kks_items", "source_column_label text not null default ''"],
	["installation_kks_items", "matched_in_cable_base boolean not null default false"],
	["installation_kks_items", "updated_by_user_id uuid"],
	["installation_pending_changes", "resolved_done boolean"],
	["priority_room_lists", "snapshot_id uuid"],
	["priority_room_lists", "source_checksum text"],
	["priority_room_lists", "author_name text not null default ''"],
	["priority_room_lists", "file_name text not null default ''"],
	["priority_room_lists", "file_type text not null default ''"],
	["priority_room_lists", "room_count integer not null default 0"],
	["priority_room_lists", "status priority_list_kanban_status not null default 'formed'"],
	["priority_room_lists", "status_updated_by_user_id uuid"],
	["priority_room_lists", "status_updated_at timestamp with time zone"],
	["priority_room_lists", "imported_by_user_id uuid"],
	["priority_room_lists", "sender_department user_department not null default 'tai'"],
	["priority_room_lists", "recipient_department user_department"],
	["priority_room_lists", "responsible_user_id uuid"],
	["priority_room_lists", "accepted_at timestamp with time zone"],
	["priority_room_lists", "completed_at timestamp with time zone"],
	["priority_room_lists", "verified_at timestamp with time zone"],
	["priority_room_lists", "updated_at timestamp with time zone not null default now()"],
	["priority_room_entries", "list_id uuid"],
	["priority_room_entries", "snapshot_id uuid"],
	["priority_room_entries", "room_name text not null default ''"],
	["priority_room_entries", "normalized_room_name text not null default ''"],
	["priority_room_entries", "sort_order integer not null default 0"],
	["priority_room_kanban_states", "snapshot_id uuid"],
	["priority_room_kanban_states", "room_id uuid"],
	["priority_room_kanban_states", "status priority_room_kanban_status not null default 'in_progress'"],
	["priority_room_kanban_states", "updated_by_user_id uuid"],
	["priority_room_kanban_states", "checked_by_user_id uuid"],
	["priority_room_kanban_states", "checked_at timestamp with time zone"],
	["priority_room_kanban_states", "updated_at timestamp with time zone not null default now()"],
	["cable_change_audit_logs", "cable_row_id uuid"],
	["remarks", "target_type remark_target_type"],
	["remarks", "target_id uuid"],
	["remarks", "list_id uuid"],
	["remarks", "assigned_department user_department"],
	["remarks", "assigned_user_id uuid"],
	["remarks", "content text not null default ''"],
	["remarks", "status remark_status not null default 'open'"],
	["remarks", "created_by_user_id uuid"],
	["remarks", "resolved_by_user_id uuid"],
	["remarks", "resolved_at timestamp with time zone"],
	["remarks", "updated_at timestamp with time zone not null default now()"],
];

const legacyCleanupStatements = [
	"drop index if exists import_snapshots_single_active_unique",
	"alter table priority_room_lists alter column snapshot_id drop not null",
	"alter table priority_room_lists drop constraint if exists priority_room_lists_snapshot_id_import_snapshots_id_fk",
];

const indexStatements = [
	"create unique index if not exists users_login_unique on users (login)",
	"create index if not exists users_status_idx on users (status)",
	"create index if not exists import_snapshots_kind_active_idx on import_snapshots (snapshot_kind, is_active)",
	"create unique index if not exists import_snapshots_kind_single_active_unique on import_snapshots (snapshot_kind, is_active) where is_active = true",
	"create index if not exists imported_cable_rows_snapshot_id_idx on imported_cable_rows (snapshot_id)",
	"create index if not exists imported_cable_rows_cable_id_idx on imported_cable_rows (cable_id)",
	"create unique index if not exists cables_external_key_unique on cables (external_key)",
	"create index if not exists cables_label_idx on cables (cable_label)",
	"create index if not exists graph_groups_snapshot_sort_idx on graph_groups (snapshot_id, level_order, graph_side, source_zone)",
	"create unique index if not exists graph_groups_snapshot_group_key_unique on graph_groups (snapshot_id, group_key)",
	"create index if not exists graph_group_rooms_snapshot_group_sort_idx on graph_group_rooms (snapshot_id, group_id, room_role, sort_order)",
	"create unique index if not exists graph_group_rooms_unique on graph_group_rooms (group_id, room_role, room_name)",
	"create index if not exists cable_progress_snapshot_room_idx on cable_progress (snapshot_id, room_id)",
	"create unique index if not exists cable_progress_snapshot_cable_unique on cable_progress (snapshot_id, cable_row_id)",
	"create unique index if not exists manual_graph_rooms_unique on manual_graph_rooms (source_zone, level, room_name)",
	"create index if not exists installation_snapshots_active_idx on installation_snapshots (is_active)",
	"create unique index if not exists installation_snapshots_single_active_unique on installation_snapshots (is_active) where is_active = true",
	"create index if not exists installation_kks_groups_snapshot_sort_idx on installation_kks_groups (snapshot_id, sort_order)",
	"create unique index if not exists installation_kks_groups_snapshot_name_unique on installation_kks_groups (snapshot_id, name)",
	"create index if not exists installation_kks_items_snapshot_group_sort_idx on installation_kks_items (snapshot_id, group_id, sort_order)",
	"create unique index if not exists installation_kks_items_group_name_unique on installation_kks_items (group_id, name)",
	"create index if not exists installation_pending_changes_status_group_idx on installation_pending_changes (status, group_id)",
	"create index if not exists installation_pending_changes_snapshot_status_idx on installation_pending_changes (snapshot_id, status)",
	"create unique index if not exists installation_pending_changes_client_mutation_unique on installation_pending_changes (client_mutation_id)",
	"create index if not exists priority_room_lists_snapshot_created_idx on priority_room_lists (snapshot_id, created_at)",
	"create index if not exists priority_room_lists_status_created_idx on priority_room_lists (status, created_at)",
	"create unique index if not exists priority_room_lists_source_checksum_unique on priority_room_lists (source_checksum)",
	"create index if not exists cable_list_items_list_idx on cable_list_items (list_id)",
	"create index if not exists cable_list_items_cable_idx on cable_list_items (cable_id)",
	"create unique index if not exists cable_list_items_list_cable_unique on cable_list_items (list_id, cable_id)",
	"create index if not exists task_comments_list_created_idx on task_comments (list_id, created_at)",
	"create index if not exists task_events_list_created_idx on task_events (list_id, created_at)",
	"create index if not exists notifications_user_created_idx on notifications (user_id, created_at)",
	"create unique index if not exists notifications_dedupe_unique on notifications (dedupe_key)",
	"create index if not exists remarks_target_idx on remarks (target_type, target_id)",
	"create index if not exists remarks_status_created_idx on remarks (status, created_at)",
	"create index if not exists priority_room_entries_snapshot_room_idx on priority_room_entries (snapshot_id, normalized_room_name)",
	"create unique index if not exists priority_room_entries_list_room_unique on priority_room_entries (list_id, normalized_room_name)",
	"create index if not exists priority_room_kanban_states_snapshot_status_idx on priority_room_kanban_states (snapshot_id, status)",
	"create unique index if not exists priority_room_kanban_states_snapshot_room_unique on priority_room_kanban_states (snapshot_id, room_id)",
	"create index if not exists change_audit_logs_changed_at_idx on change_audit_logs (changed_at)",
	"create index if not exists change_audit_logs_effective_date_idx on change_audit_logs (effective_date)",
	"create index if not exists change_audit_logs_backdated_effective_changed_idx on change_audit_logs (is_backdated, effective_date, changed_at)",
	"create index if not exists cable_change_audit_logs_changed_at_idx on cable_change_audit_logs (changed_at)",
	"create index if not exists cable_change_audit_logs_effective_date_idx on cable_change_audit_logs (effective_date)",
	"create index if not exists cable_change_audit_logs_backdated_effective_changed_idx on cable_change_audit_logs (is_backdated, effective_date, changed_at)",
	"create index if not exists cable_change_audit_logs_cable_row_idx on cable_change_audit_logs (cable_row_id)",
];

const foreignKeyDefinitions = [
	["users_reviewed_by_user_id_fk", "users", "reviewed_by_user_id", "users", "id", "set null"],
	[
		"import_snapshots_imported_by_user_id_fk",
		"import_snapshots",
		"imported_by_user_id",
		"users",
		"id",
		"restrict",
	],
	[
		"imported_cable_rows_snapshot_id_fk",
		"imported_cable_rows",
		"snapshot_id",
		"import_snapshots",
		"id",
		"cascade",
	],
	["imported_cable_rows_cable_id_fk", "imported_cable_rows", "cable_id", "cables", "id", "set null"],
	[
		"cables_progress_updated_by_user_id_fk",
		"cables",
		"progress_updated_by_user_id",
		"users",
		"id",
		"set null",
	],
	["graph_groups_snapshot_id_fk", "graph_groups", "snapshot_id", "import_snapshots", "id", "cascade"],
	[
		"graph_group_rooms_snapshot_id_fk",
		"graph_group_rooms",
		"snapshot_id",
		"import_snapshots",
		"id",
		"cascade",
	],
	["graph_group_rooms_group_id_fk", "graph_group_rooms", "group_id", "graph_groups", "id", "cascade"],
	[
		"graph_group_rooms_updated_by_user_id_fk",
		"graph_group_rooms",
		"updated_by_user_id",
		"users",
		"id",
		"set null",
	],
	["cable_progress_snapshot_id_fk", "cable_progress", "snapshot_id", "import_snapshots", "id", "cascade"],
	["cable_progress_group_id_fk", "cable_progress", "group_id", "graph_groups", "id", "cascade"],
	["cable_progress_room_id_fk", "cable_progress", "room_id", "graph_group_rooms", "id", "cascade"],
	[
		"cable_progress_cable_row_id_fk",
		"cable_progress",
		"cable_row_id",
		"imported_cable_rows",
		"id",
		"cascade",
	],
	["cable_progress_updated_by_user_id_fk", "cable_progress", "updated_by_user_id", "users", "id", "set null"],
	[
		"manual_graph_rooms_created_by_user_id_fk",
		"manual_graph_rooms",
		"created_by_user_id",
		"users",
		"id",
		"set null",
	],
	[
		"installation_snapshots_imported_by_user_id_fk",
		"installation_snapshots",
		"imported_by_user_id",
		"users",
		"id",
		"restrict",
	],
	[
		"installation_kks_groups_snapshot_id_fk",
		"installation_kks_groups",
		"snapshot_id",
		"installation_snapshots",
		"id",
		"cascade",
	],
	[
		"installation_kks_items_snapshot_id_fk",
		"installation_kks_items",
		"snapshot_id",
		"installation_snapshots",
		"id",
		"cascade",
	],
	[
		"installation_kks_items_group_id_fk",
		"installation_kks_items",
		"group_id",
		"installation_kks_groups",
		"id",
		"cascade",
	],
	[
		"installation_kks_items_updated_by_user_id_fk",
		"installation_kks_items",
		"updated_by_user_id",
		"users",
		"id",
		"set null",
	],
	[
		"installation_pending_changes_snapshot_id_fk",
		"installation_pending_changes",
		"snapshot_id",
		"installation_snapshots",
		"id",
		"cascade",
	],
	[
		"installation_pending_changes_group_id_fk",
		"installation_pending_changes",
		"group_id",
		"installation_kks_groups",
		"id",
		"cascade",
	],
	[
		"installation_pending_changes_kks_item_id_fk",
		"installation_pending_changes",
		"kks_item_id",
		"installation_kks_items",
		"id",
		"cascade",
	],
	[
		"installation_pending_changes_user_id_fk",
		"installation_pending_changes",
		"user_id",
		"users",
		"id",
		"restrict",
	],
	[
		"priority_room_lists_snapshot_id_fk",
		"priority_room_lists",
		"snapshot_id",
		"import_snapshots",
		"id",
		"set null",
	],
	[
		"priority_room_lists_responsible_user_id_fk",
		"priority_room_lists",
		"responsible_user_id",
		"users",
		"id",
		"set null",
	],
	[
		"priority_room_lists_imported_by_user_id_fk",
		"priority_room_lists",
		"imported_by_user_id",
		"users",
		"id",
		"restrict",
	],
	[
		"priority_room_lists_status_updated_by_user_id_fk",
		"priority_room_lists",
		"status_updated_by_user_id",
		"users",
		"id",
		"set null",
	],
	["remarks_created_by_user_id_fk", "remarks", "created_by_user_id", "users", "id", "restrict"],
	["remarks_resolved_by_user_id_fk", "remarks", "resolved_by_user_id", "users", "id", "set null"],
	["remarks_list_id_fk", "remarks", "list_id", "priority_room_lists", "id", "set null"],
	["remarks_assigned_user_id_fk", "remarks", "assigned_user_id", "users", "id", "set null"],
	["cable_list_items_list_id_fk", "cable_list_items", "list_id", "priority_room_lists", "id", "cascade"],
	["cable_list_items_cable_id_fk", "cable_list_items", "cable_id", "cables", "id", "restrict"],
	["task_comments_list_id_fk", "task_comments", "list_id", "priority_room_lists", "id", "cascade"],
	["task_comments_created_by_user_id_fk", "task_comments", "created_by_user_id", "users", "id", "restrict"],
	["task_events_list_id_fk", "task_events", "list_id", "priority_room_lists", "id", "cascade"],
	["task_events_actor_user_id_fk", "task_events", "actor_user_id", "users", "id", "set null"],
	["notifications_user_id_fk", "notifications", "user_id", "users", "id", "cascade"],
	["notifications_list_id_fk", "notifications", "list_id", "priority_room_lists", "id", "cascade"],
	[
		"priority_room_entries_list_id_fk",
		"priority_room_entries",
		"list_id",
		"priority_room_lists",
		"id",
		"cascade",
	],
	[
		"priority_room_entries_snapshot_id_fk",
		"priority_room_entries",
		"snapshot_id",
		"import_snapshots",
		"id",
		"cascade",
	],
	[
		"priority_room_kanban_states_snapshot_id_fk",
		"priority_room_kanban_states",
		"snapshot_id",
		"import_snapshots",
		"id",
		"cascade",
	],
	[
		"priority_room_kanban_states_room_id_fk",
		"priority_room_kanban_states",
		"room_id",
		"graph_group_rooms",
		"id",
		"cascade",
	],
	[
		"priority_room_kanban_states_updated_by_user_id_fk",
		"priority_room_kanban_states",
		"updated_by_user_id",
		"users",
		"id",
		"restrict",
	],
	[
		"priority_room_kanban_states_checked_by_user_id_fk",
		"priority_room_kanban_states",
		"checked_by_user_id",
		"users",
		"id",
		"set null",
	],
	[
		"change_audit_logs_snapshot_id_fk",
		"change_audit_logs",
		"snapshot_id",
		"import_snapshots",
		"id",
		"set null",
	],
	["change_audit_logs_group_id_fk", "change_audit_logs", "group_id", "graph_groups", "id", "set null"],
	["change_audit_logs_room_id_fk", "change_audit_logs", "room_id", "graph_group_rooms", "id", "set null"],
	["change_audit_logs_user_id_fk", "change_audit_logs", "user_id", "users", "id", "restrict"],
	[
		"cable_change_audit_logs_snapshot_id_fk",
		"cable_change_audit_logs",
		"snapshot_id",
		"import_snapshots",
		"id",
		"set null",
	],
	[
		"cable_change_audit_logs_group_id_fk",
		"cable_change_audit_logs",
		"group_id",
		"graph_groups",
		"id",
		"set null",
	],
	[
		"cable_change_audit_logs_room_id_fk",
		"cable_change_audit_logs",
		"room_id",
		"graph_group_rooms",
		"id",
		"set null",
	],
	[
		"cable_change_audit_logs_cable_row_id_fk",
		"cable_change_audit_logs",
		"cable_row_id",
		"imported_cable_rows",
		"id",
		"set null",
	],
	["cable_change_audit_logs_user_id_fk", "cable_change_audit_logs", "user_id", "users", "id", "restrict"],
];

function getRequiredEnvironmentVariable(name) {
	const value = process.env[name];

	if (!value) {
		throw new Error(`Missing required predeploy env: ${name}.`);
	}

	return value;
}

function assertUnquotedEnvironmentVariable(name, value) {
	if (value.startsWith('"') || value.endsWith('"')) {
		throw new Error(`${name} must not include wrapping quotes in Railway Variables.`);
	}
}

function assertResolvedRailwayReference(name, value) {
	if (value.includes("${{")) {
		throw new Error(`${name} contains an unresolved Railway reference: ${value}.`);
	}
}

function assertRequiredEnvironment() {
	const missingVariables = requiredEnvironmentVariables.filter((name) => !process.env[name]);

	if (missingVariables.length > 0) {
		throw new Error(`Missing required predeploy env: ${missingVariables.join(", ")}.`);
	}

	const databaseUrl = getRequiredEnvironmentVariable("DATABASE_URL");
	const superusersJson = getRequiredEnvironmentVariable("AUTH_SUPERUSERS_JSON");

	assertUnquotedEnvironmentVariable("DATABASE_URL", databaseUrl);
	assertUnquotedEnvironmentVariable("AUTH_SUPERUSERS_JSON", superusersJson);
	assertResolvedRailwayReference("DATABASE_URL", databaseUrl);

	JSON.parse(superusersJson);
}

function runCommand(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			shell: false,
		});

		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? `exit code ${code}`}.`));
		});
	});
}

function quoteLiteral(value) {
	return `'${value.replaceAll("'", "''")}'`;
}

function createEnumTypeStatement(name, values) {
	return `
		do $$
		begin
			if not exists (select 1 from pg_type where typname = ${quoteLiteral(name)}) then
				create type ${name} as enum (${values.map(quoteLiteral).join(", ")});
			end if;
		end
		$$;
	`;
}

function createEnumValueStatement(name, value) {
	return `alter type ${name} add value if not exists ${quoteLiteral(value)}`;
}

function createColumnStatement(tableName, columnDefinition) {
	return `alter table ${tableName} add column if not exists ${columnDefinition}`;
}

function createForeignKeyStatement(definition) {
	const [name, tableName, columnName, targetTableName, targetColumnName, onDelete] = definition;

	return `
		do $$
		begin
			if not exists (select 1 from pg_constraint where conname = ${quoteLiteral(name)}) then
				alter table ${tableName}
					add constraint ${name}
					foreign key (${columnName})
					references ${targetTableName} (${targetColumnName})
					on delete ${onDelete};
			end if;
		end
		$$;
	`;
}

async function runStatements(sql, statements) {
	for (const statement of statements) {
		await sql.unsafe(statement);
	}
}

async function syncDatabaseSchema() {
	const sql = postgres(getRequiredEnvironmentVariable("DATABASE_URL"), {
		onnotice: () => {},
		prepare: false,
	});

	try {
		await sql.begin(async (transaction) => {
			await transaction`create extension if not exists pgcrypto`;
			await runStatements(
				transaction,
				enumDefinitions.map(([name, values]) => createEnumTypeStatement(name, values))
			);
			await runStatements(
				transaction,
				enumDefinitions.flatMap(([name, values]) =>
					values.map((value) => createEnumValueStatement(name, value))
				)
			);
			await runStatements(
				transaction,
				tableDefinitions.map(([, statement]) => statement)
			);
			await runStatements(
				transaction,
				columnDefinitions.map(([tableName, column]) => createColumnStatement(tableName, column))
			);
			await runStatements(transaction, legacyCleanupStatements);
			await runStatements(transaction, indexStatements);
			await runStatements(transaction, foreignKeyDefinitions.map(createForeignKeyStatement));
		});
	} finally {
		await sql.end();
	}
}

async function runPredeploy() {
	assertRequiredEnvironment();

	process.stdout.write("[predeploy] Applying database schema\n");
	await syncDatabaseSchema();

	process.stdout.write("[predeploy] Seeding configured superusers\n");
	await runCommand("bun", ["./seed-superusers.mjs"]);

	process.stdout.write("[predeploy] Complete\n");
}

try {
	await runPredeploy();
} catch (error) {
	process.stderr.write(`[predeploy] ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
}
