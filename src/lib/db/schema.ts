import {
	boolean,
	date,
	doublePrecision,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { userRoles } from "@/lib/auth/shared";

export const userRoleEnum = pgEnum("user_role", userRoles);
export const snapshotSourceTypeEnum = pgEnum("snapshot_source_type", [
	// Keep ODS for already stored snapshots; new uploads are limited in app code.
	"ods",
	"xlsx",
	"xls",
]);
export const graphSideEnum = pgEnum("graph_side", ["dirty", "clean"]);
export const graphSubzoneEnum = pgEnum("graph_subzone", ["dirty", "clean"]);
export const roomRoleEnum = pgEnum("graph_room_role", ["primary", "secondary"]);

export const users = pgTable(
	"users",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		login: text("login").notNull(),
		passwordHash: text("password_hash").notNull(),
		role: userRoleEnum("role").notNull().default("user"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [uniqueIndex("users_login_unique").on(table.login)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const importSnapshots = pgTable("import_snapshots", {
	id: uuid("id").defaultRandom().primaryKey(),
	fileName: text("file_name").notNull(),
	fileType: snapshotSourceTypeEnum("file_type").notNull(),
	checksum: text("checksum").notNull(),
	importedByUserId: uuid("imported_by_user_id")
		.notNull()
		.references(() => users.id, { onDelete: "restrict" }),
	rowCount: integer("row_count").notNull().default(0),
	isActive: boolean("is_active").notNull().default(false),
	summary: jsonb("summary")
		.$type<{
			levels: string[];
			sides: Array<{
				side: "dirty" | "clean";
				groupCount: number;
				roomCount: number;
			}>;
		}>()
		.notNull()
		.default({
			levels: [],
			sides: [],
		}),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const importedCableRows = pgTable("imported_cable_rows", {
	id: uuid("id").defaultRandom().primaryKey(),
	snapshotId: uuid("snapshot_id")
		.notNull()
		.references(() => importSnapshots.id, { onDelete: "cascade" }),
	sourceRowIndex: integer("source_row_index").notNull(),
	cableLabel: text("cable_label").notNull(),
	cableJournal: text("cable_journal").notNull().default(""),
	cableNumber: text("cable_number").notNull().default(""),
	repeatFrom: text("repeat_from").notNull().default(""),
	repeatTo: text("repeat_to").notNull().default(""),
	repeatKks: text("repeat_kks").notNull().default(""),
	fromRoom: text("from_room").notNull().default(""),
	fromLocation: text("from_location").notNull().default(""),
	fromEquipment: text("from_equipment").notNull().default(""),
	toRoom: text("to_room").notNull().default(""),
	threadLength: doublePrecision("thread_length").notNull().default(0),
	threadCount: integer("thread_count").notNull().default(0),
	totalLength: doublePrecision("total_length").notNull().default(0),
	level: text("level").notNull().default(""),
	levelOrder: doublePrecision("level_order").notNull().default(0),
	fromZone: text("from_zone").notNull().default(""),
	toZone: text("to_zone").notNull().default(""),
	graphSide: graphSideEnum("graph_side").notNull(),
	graphSubzone: graphSubzoneEnum("graph_subzone"),
	farthestShaft: integer("farthest_shaft"),
	shaftValues: jsonb("shaft_values")
		.$type<
			Array<{
				column: number;
				label: string;
				value: string;
				shaft: number;
			}>
		>()
		.notNull()
		.default([]),
	route: text("route").notNull().default(""),
	rawRow: jsonb("raw_row").$type<string[]>().notNull().default([]),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const graphGroups = pgTable(
	"graph_groups",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		snapshotId: uuid("snapshot_id")
			.notNull()
			.references(() => importSnapshots.id, { onDelete: "cascade" }),
		groupKey: text("group_key").notNull(),
		graphSide: graphSideEnum("graph_side").notNull(),
		graphSubzone: graphSubzoneEnum("graph_subzone"),
		sourceZone: text("source_zone").notNull().default(""),
		level: text("level").notNull(),
		levelOrder: doublePrecision("level_order").notNull().default(0),
		primaryRooms: jsonb("primary_rooms")
			.$type<string[]>()
			.notNull()
			.default([]),
		secondaryRooms: jsonb("secondary_rooms")
			.$type<string[]>()
			.notNull()
			.default([]),
		cableCount: integer("cable_count").notNull().default(0),
		threadCount: integer("thread_count").notNull().default(0),
		totalLength: doublePrecision("total_length").notNull().default(0),
		noShaftThreads: integer("no_shaft_threads").notNull().default(0),
		shaft1Threads: integer("shaft1_threads").notNull().default(0),
		shaft2Threads: integer("shaft2_threads").notNull().default(0),
		shaft3Threads: integer("shaft3_threads").notNull().default(0),
		shaft4Threads: integer("shaft4_threads").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("graph_groups_snapshot_group_key_unique").on(
			table.snapshotId,
			table.groupKey,
		),
	],
);

export const graphGroupRooms = pgTable(
	"graph_group_rooms",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		snapshotId: uuid("snapshot_id")
			.notNull()
			.references(() => importSnapshots.id, { onDelete: "cascade" }),
		groupId: uuid("group_id")
			.notNull()
			.references(() => graphGroups.id, { onDelete: "cascade" }),
		roomName: text("room_name").notNull(),
		roomRole: roomRoleEnum("room_role").notNull(),
		sortOrder: integer("sort_order").notNull().default(0),
		cableCount: integer("cable_count").notNull().default(0),
		threadCount: integer("thread_count").notNull().default(0),
		totalLength: doublePrecision("total_length").notNull().default(0),
		progress: integer("progress").notNull().default(0),
		effectiveDate: date("effective_date", { mode: "string" }),
		updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("graph_group_rooms_unique").on(
			table.groupId,
			table.roomRole,
			table.roomName,
		),
	],
);

export const manualGraphRooms = pgTable(
	"manual_graph_rooms",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		roomName: text("room_name").notNull(),
		sourceZone: text("source_zone").notNull(),
		level: text("level").notNull(),
		createdByUserId: uuid("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("manual_graph_rooms_unique").on(
			table.sourceZone,
			table.level,
			table.roomName,
		),
	],
);

export const changeAuditLogs = pgTable("change_audit_logs", {
	id: uuid("id").defaultRandom().primaryKey(),
	snapshotId: uuid("snapshot_id").references(() => importSnapshots.id, {
		onDelete: "set null",
	}),
	groupId: uuid("group_id").references(() => graphGroups.id, {
		onDelete: "set null",
	}),
	roomId: uuid("room_id").references(() => graphGroupRooms.id, {
		onDelete: "set null",
	}),
	roomName: text("room_name").notNull(),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "restrict" }),
	userLogin: text("user_login").notNull(),
	changedAt: timestamp("changed_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	effectiveDate: date("effective_date", { mode: "string" }).notNull(),
	isBackdated: boolean("is_backdated").notNull().default(false),
	oldProgress: integer("old_progress").notNull(),
	newProgress: integer("new_progress").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export type ImportSnapshot = typeof importSnapshots.$inferSelect;
export type ImportedCableRow = typeof importedCableRows.$inferSelect;
export type GraphGroup = typeof graphGroups.$inferSelect;
export type GraphGroupRoom = typeof graphGroupRooms.$inferSelect;
export type ManualGraphRoom = typeof manualGraphRooms.$inferSelect;
export type ChangeAuditLog = typeof changeAuditLogs.$inferSelect;
