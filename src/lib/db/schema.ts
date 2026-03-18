import {
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { userRoles } from "@/lib/auth/shared";

export const userRoleEnum = pgEnum("user_role", userRoles);

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
