#!/usr/bin/env node

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
	["snapshot_source_type", ["ods", "xlsx", "xls"]],
	["snapshot_kind", ["demolition", "installation"]],
	["graph_side", ["dirty", "clean"]],
	["graph_subzone", ["dirty", "clean"]],
	["graph_room_role", ["primary", "secondary"]],
	["installation_pending_status", ["pending", "applied", "discarded"]],
	["installation_kks_item_type", ["mechanism", "cable"]],
];

const tableDefinitions = [
	[
		"users",
		`create table if not exists users (
			id uuid primary key default gen_random_uuid(),
			login text not null,
			password_hash text not null,
			role user_role not null default 'user',
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
		"imported_cable_rows",
		`create table if not exists imported_cable_rows (
			id uuid primary key default gen_random_uuid(),
			snapshot_id uuid not null,
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
	["users", "updated_at timestamp with time zone not null default now()"],
	["import_snapshots", "snapshot_kind snapshot_kind not null default 'demolition'"],
	["import_snapshots", 'summary jsonb not null default \'{"levels":[],"sides":[]}\'::jsonb'],
	["imported_cable_rows", "cable_journal text not null default ''"],
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
	["cable_change_audit_logs", "cable_row_id uuid"],
];

const legacyCleanupStatements = ["drop index if exists import_snapshots_single_active_unique"];

const indexStatements = [
	"create unique index if not exists users_login_unique on users (login)",
	"create index if not exists users_status_idx on users (status)",
	"create index if not exists import_snapshots_kind_active_idx on import_snapshots (snapshot_kind, is_active)",
	"create unique index if not exists import_snapshots_kind_single_active_unique on import_snapshots (snapshot_kind, is_active) where is_active = true",
	"create index if not exists imported_cable_rows_snapshot_id_idx on imported_cable_rows (snapshot_id)",
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
	await runCommand("node", ["./scripts/seed-superusers.mjs"]);

	process.stdout.write("[predeploy] Complete\n");
}

try {
	await runPredeploy();
} catch (error) {
	process.stderr.write(`[predeploy] ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
}
