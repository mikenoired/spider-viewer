import { createHash } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";
import * as Xlsx from "xlsx";

import type { AuthSession, UserDepartment } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import {
	cableListItems,
	cables,
	notifications,
	priorityRoomLists,
	remarks,
	taskComments,
	taskEvents,
	users,
} from "@/lib/db/schema";

import { ensureCanonicalCableBase, ensureUploadFile, getCableExternalKey } from "./import.server";
import type {
	CreateKanbanRemarkInput,
	CreateTaskCommentInput,
	PriorityListKanbanStatus,
	TransitionKanbanTaskInput,
} from "./shared";

const stageRecipient: Record<PriorityListKanbanStatus, UserDepartment> = {
	formed: "skm",
	in_progress: "skm",
	curator_review: "tai",
	adjustment: "commissioning",
	done: "tai",
};

const stageTitles: Record<PriorityListKanbanStatus, string> = {
	formed: "Список сформирован",
	in_progress: "Список в работе",
	curator_review: "На проверку куратору",
	adjustment: "Список в наладке",
	done: "Список выполнен",
};

type ParsedTaskCable = {
	rowIndex: number;
	cableLabel: string;
	cableJournal: string;
	cableNumber: string;
	fromRoom: string;
	toRoom: string;
	progress: number | null;
};

function normalize(value: unknown) {
	return String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeHeader(value: unknown) {
	return normalize(value).toLowerCase();
}

function findHeaderRow(rows: unknown[][]) {
	return rows.findIndex((row) =>
		row.some((cell) => /кабель|марка|журнал|номер/i.test(normalizeHeader(cell)))
	);
}

function findColumn(headers: string[], aliases: string[]) {
	return headers.findIndex((header) => aliases.some((alias) => header === alias || header.includes(alias)));
}

function parseProgress(value: unknown) {
	const raw = normalize(value).replace("%", "").replace(",", ".");

	if (!raw) return null;
	if (["да", "готово", "выполнено", "done", "true"].includes(raw.toLowerCase())) return 100;
	const parsed = Number(raw);

	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? Math.round(parsed) : null;
}

function parseTaskCableRows(fileName: string, buffer: Buffer): ParsedTaskCable[] {
	const workbook = Xlsx.read(buffer, { type: "buffer", raw: false, cellDates: false });
	const sheetName = workbook.SheetNames[0];
	const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;

	if (!sheet) throw new Error(`В "${fileName}" не найден лист со списком кабелей.`);

	const rows = Xlsx.utils.sheet_to_json<unknown[]>(sheet, {
		header: 1,
		raw: false,
		defval: "",
		blankrows: false,
	});
	const headerRowIndex = findHeaderRow(rows);
	const headers = (headerRowIndex >= 0 ? rows[headerRowIndex] : []).map(normalizeHeader);
	const dataRows = rows.slice(headerRowIndex >= 0 ? headerRowIndex + 1 : 0);
	const cableIndex = findColumn(headers, ["кабель", "марка", "маркировка", "cable"]);
	const journalIndex = findColumn(headers, ["журнал", "cable journal"]);
	const numberIndex = findColumn(headers, ["номер", "нитка", "thread number"]);
	const fromIndex = findColumn(headers, ["откуда", "from", "начало"]);
	const toIndex = findColumn(headers, ["куда", "to", "конец"]);
	const progressIndex = findColumn(headers, ["прогресс", "готов", "выполн", "progress", "status"]);
	const unique = new Map<string, ParsedTaskCable>();

	for (const [offset, row] of dataRows.entries()) {
		const values = row.map(normalize);
		const cableLabel = values[cableIndex >= 0 ? cableIndex : 0] ?? values.find(Boolean) ?? "";
		const cableJournal = journalIndex >= 0 ? (values[journalIndex] ?? "") : "";
		const cableNumber = numberIndex >= 0 ? (values[numberIndex] ?? "") : "";
		const fromRoom = fromIndex >= 0 ? (values[fromIndex] ?? "") : "";
		const toRoom = toIndex >= 0 ? (values[toIndex] ?? "") : "";

		if (!cableLabel && !cableJournal && !cableNumber) continue;

		const item = {
			rowIndex: offset + (headerRowIndex >= 0 ? headerRowIndex + 2 : 1),
			cableLabel,
			cableJournal,
			cableNumber,
			fromRoom,
			toRoom,
			progress: progressIndex >= 0 ? parseProgress(values[progressIndex]) : null,
		};
		const key = getCableExternalKey(item);

		if (!unique.has(key)) unique.set(key, item);
	}

	if (unique.size === 0) throw new Error(`В "${fileName}" не найдены кабельные нитки.`);

	return [...unique.values()];
}

async function analyzeParsedTaskCables(parsed: ParsedTaskCable[]) {
	await ensureCanonicalCableBase();
	const db = getDb();
	const baseCables = await db
		.select({
			id: cables.id,
			externalKey: cables.externalKey,
			cableLabel: cables.cableLabel,
		})
		.from(cables);
	const cablesByKey = new Map(baseCables.map((cable) => [cable.externalKey, cable]));
	const cablesByLabel = new Map<string, typeof baseCables>();

	for (const cable of baseCables) {
		const label = normalizeHeader(cable.cableLabel);
		cablesByLabel.set(label, [...(cablesByLabel.get(label) ?? []), cable]);
	}

	const matched: Array<{ parsed: ParsedTaskCable; cableId: string }> = [];
	const missing: string[] = [];
	const ambiguous: string[] = [];

	for (const parsedCable of parsed) {
		const exact = cablesByKey.get(getCableExternalKey(parsedCable));
		const labelMatches = cablesByLabel.get(normalizeHeader(parsedCable.cableLabel)) ?? [];
		const match = exact ?? (labelMatches.length === 1 ? labelMatches[0] : null);

		if (match) {
			matched.push({ parsed: parsedCable, cableId: match.id });
		} else if (labelMatches.length > 1) {
			ambiguous.push(parsedCable.cableLabel || parsedCable.cableJournal || parsedCable.cableNumber);
		} else {
			missing.push(parsedCable.cableLabel || parsedCable.cableJournal || parsedCable.cableNumber);
		}
	}

	return { matched, missing, ambiguous, baseCount: baseCables.length };
}

export function getAllowedImportStages(session: AuthSession): PriorityListKanbanStatus[] {
	if (session.role === "super-admin")
		return ["formed", "in_progress", "curator_review", "adjustment", "done"];
	if (session.department === "tai") return ["formed", "curator_review"];
	if (session.department === "commissioning") return ["adjustment"];
	return [];
}

export async function analyzeCableTaskListFromFormData(formData: FormData, session: AuthSession) {
	const { file, buffer } = await ensureUploadFile(formData);
	const parsed = parseTaskCableRows(file.name, buffer);
	const result = await analyzeParsedTaskCables(parsed);

	return {
		fileName: file.name,
		totalCount: parsed.length,
		matchedCount: result.matched.length,
		missing: result.missing.slice(0, 100),
		ambiguous: result.ambiguous.slice(0, 100),
		baseCount: result.baseCount,
		allowedStages: getAllowedImportStages(session),
	};
}

async function addDepartmentNotifications(
	department: UserDepartment | null,
	listId: string,
	type: string,
	message: string,
	dedupePrefix: string,
	excludeUserId?: string
) {
	if (!department) return;

	const db = getDb();
	const recipients = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.department, department), eq(users.status, "active")));
	const values = recipients
		.filter((recipient) => recipient.id !== excludeUserId)
		.map((recipient) => ({
			userId: recipient.id,
			listId,
			type,
			message,
			dedupeKey: `${dedupePrefix}:${recipient.id}`,
		}));

	if (values.length > 0) await db.insert(notifications).values(values).onConflictDoNothing();
}

async function addTaskEvent(listId: string, eventType: string, message: string, actorUserId: string) {
	const db = getDb();
	const [event] = await db
		.insert(taskEvents)
		.values({ listId, eventType, message, actorUserId })
		.returning({ id: taskEvents.id });

	return event;
}

export async function importCableTaskListFromFormData(formData: FormData, session: AuthSession) {
	const { file, fileType, buffer } = await ensureUploadFile(formData);
	const stage = String(formData.get("stage") ?? "formed") as PriorityListKanbanStatus;

	if (!getAllowedImportStages(session).includes(stage)) {
		throw new Error("У вашей роли нет права добавить список в выбранный этап.");
	}

	const parsed = parseTaskCableRows(file.name, buffer);
	const result = await analyzeParsedTaskCables(parsed);
	if (result.matched.length === 0)
		throw new Error("Ни одна позиция списка не найдена в генеральной кабельной базе.");

	const checksum = createHash("sha256").update(buffer).digest("hex");
	const db = getDb();
	const [existing] = await db
		.select({ id: priorityRoomLists.id })
		.from(priorityRoomLists)
		.where(eq(priorityRoomLists.sourceChecksum, checksum))
		.limit(1);

	if (existing) {
		return {
			id: existing.id,
			reused: true,
			matchedCount: result.matched.length,
			missingCount: result.missing.length,
		};
	}

	const now = new Date();
	const recipientDepartment = stageRecipient[stage];
	const [list] = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(priorityRoomLists)
			.values({
				authorName: session.login,
				fileName: file.name,
				fileType,
				roomCount: result.matched.length,
				sourceChecksum: checksum,
				senderDepartment: session.department,
				recipientDepartment,
				status: stage,
				statusUpdatedByUserId: session.id,
				statusUpdatedAt: now,
				importedByUserId: session.id,
				createdAt: now,
				updatedAt: now,
			})
			.returning({ id: priorityRoomLists.id });

		await tx.insert(cableListItems).values(
			result.matched.map(({ parsed: item, cableId }) => ({
				listId: created.id,
				cableId,
				sourceRowIndex: item.rowIndex,
				importedProgress: item.progress,
				createdAt: now,
			}))
		);

		for (const { parsed: item, cableId } of result.matched) {
			if (item.progress === null) continue;
			await tx
				.update(cables)
				.set({
					progress: item.progress,
					progressUpdatedByUserId: session.id,
					progressUpdatedAt: now,
					updatedAt: now,
				})
				.where(eq(cables.id, cableId));
		}

		await tx.insert(taskEvents).values({
			listId: created.id,
			eventType: "created",
			message: `${session.login} создал список и передал его: ${stageTitles[stage]}.`,
			actorUserId: session.id,
			createdAt: now,
		});

		return [created];
	});

	await addDepartmentNotifications(
		recipientDepartment,
		list.id,
		"task_assigned",
		`Вам назначен список «${file.name}».`,
		`task-created:${list.id}`,
		session.id
	);

	return {
		id: list.id,
		reused: false,
		matchedCount: result.matched.length,
		missingCount: result.missing.length,
	};
}

function canTransition(
	input: TransitionKanbanTaskInput,
	session: AuthSession,
	current: PriorityListKanbanStatus
) {
	if (session.role === "super-admin") return true;
	if (input.action === "accept") return session.department === "skm" && current === "formed";
	if (input.action === "complete") return session.department === "skm" && current === "in_progress";
	if (input.action === "confirm" || input.action === "return") {
		return (session.department === "tai" || session.department === "curator") && current === "curator_review";
	}
	return session.department === "commissioning" && current === "adjustment";
}

function transitionTarget(input: TransitionKanbanTaskInput, current: PriorityListKanbanStatus) {
	if (input.action === "accept") return { status: "in_progress" as const, department: "skm" as const };
	if (input.action === "complete") return { status: "curator_review" as const, department: "tai" as const };
	if (input.action === "confirm") return { status: "done" as const, department: "tai" as const };
	if (input.action === "return")
		return { status: "adjustment" as const, department: input.recipientDepartment ?? "skm" };
	return {
		status: input.status ?? current,
		department: input.recipientDepartment ?? stageRecipient[input.status ?? current],
	};
}

export async function transitionKanbanTask(input: TransitionKanbanTaskInput, session: AuthSession) {
	const db = getDb();
	const [list] = await db
		.select({
			id: priorityRoomLists.id,
			fileName: priorityRoomLists.fileName,
			status: priorityRoomLists.status,
			responsibleUserId: priorityRoomLists.responsibleUserId,
		})
		.from(priorityRoomLists)
		.where(eq(priorityRoomLists.id, input.listId))
		.limit(1);
	if (!list) throw new Error("Карточка Kanban не найдена.");
	if (!canTransition(input, session, list.status)) throw new Error("Этот переход недоступен вашей роли.");
	if (
		input.action === "complete" &&
		session.role !== "super-admin" &&
		list.responsibleUserId !== session.id
	) {
		throw new Error("Отметить выполненной может только назначенный исполнитель.");
	}

	const target = transitionTarget(input, list.status);
	if (target.status === list.status && input.action === "move") return { id: list.id, status: list.status };
	const now = new Date();
	const updateValues = {
		status: target.status,
		recipientDepartment: target.department,
		statusUpdatedByUserId: session.id,
		statusUpdatedAt: now,
		updatedAt: now,
		...(input.action === "accept" ? { responsibleUserId: session.id, acceptedAt: now } : {}),
		...(input.action === "complete" ? { completedAt: now } : {}),
		...(input.action === "confirm" ? { verifiedAt: now } : {}),
	};
	const [updated] = await db
		.update(priorityRoomLists)
		.set(updateValues)
		.where(eq(priorityRoomLists.id, list.id))
		.returning({ id: priorityRoomLists.id, status: priorityRoomLists.status });
	if (!updated) throw new Error("Не удалось изменить статус карточки.");

	const event = await addTaskEvent(
		list.id,
		input.action,
		`${session.login}: ${stageTitles[list.status]} → ${stageTitles[target.status]}.`,
		session.id
	);
	await addDepartmentNotifications(
		target.department,
		list.id,
		"task_status_changed",
		`Список «${list.fileName}» переведён в этап «${stageTitles[target.status]}».`,
		`task-event:${event?.id ?? `${list.id}:${target.status}`}`,
		session.id
	);
	return updated;
}

export async function createTaskComment(input: CreateTaskCommentInput, session: AuthSession) {
	const db = getDb();
	const [comment] = await db
		.insert(taskComments)
		.values({ listId: input.listId, content: input.content, createdByUserId: session.id })
		.returning({ id: taskComments.id, createdAt: taskComments.createdAt });
	if (!comment) throw new Error("Не удалось сохранить комментарий.");
	await addTaskEvent(input.listId, "comment", `${session.login} добавил комментарий.`, session.id);
	return comment;
}

export async function createKanbanRemark(input: CreateKanbanRemarkInput, session: AuthSession) {
	const db = getDb();
	const [list] = await db
		.select({ id: priorityRoomLists.id })
		.from(priorityRoomLists)
		.where(eq(priorityRoomLists.id, input.listId))
		.limit(1);
	if (!list) throw new Error("Карточка Kanban не найдена.");

	if (input.cableId) {
		const [item] = await db
			.select({ id: cableListItems.id })
			.from(cableListItems)
			.where(and(eq(cableListItems.listId, input.listId), eq(cableListItems.cableId, input.cableId)))
			.limit(1);
		if (!item) throw new Error("Выбранный кабель не входит в этот список.");
	}

	if (input.assignedUserId) {
		const [recipient] = await db
			.select({ department: users.department, status: users.status })
			.from(users)
			.where(eq(users.id, input.assignedUserId))
			.limit(1);
		if (!recipient || recipient.status !== "active") throw new Error("Получатель замечания недоступен.");
		if (input.assignedDepartment && recipient.department !== input.assignedDepartment) {
			throw new Error("Получатель не относится к выбранному подразделению.");
		}
	}
	const [remark] = await db
		.insert(remarks)
		.values({
			targetType: input.cableId ? "cable" : "priority_list",
			targetId: input.cableId ?? input.listId,
			listId: input.listId,
			content: input.content,
			assignedDepartment: input.assignedDepartment,
			assignedUserId: input.assignedUserId,
			createdByUserId: session.id,
		})
		.returning({ id: remarks.id });
	if (!remark) throw new Error("Не удалось создать замечание.");

	const event = await addTaskEvent(input.listId, "remark", `${session.login} создал замечание.`, session.id);
	if (input.assignedUserId) {
		await db
			.insert(notifications)
			.values({
				userId: input.assignedUserId,
				listId: input.listId,
				remarkId: remark.id,
				type: "remark_assigned",
				message: "Вам адресовано замечание по списку кабелей.",
				dedupeKey: `remark:${remark.id}:${input.assignedUserId}`,
			})
			.onConflictDoNothing();
	}
	await addDepartmentNotifications(
		input.assignedDepartment ?? null,
		input.listId,
		"remark_assigned",
		"Вашему подразделению адресовано замечание по списку кабелей.",
		`remark-event:${event?.id ?? remark.id}`,
		session.id
	);
	return remark;
}

export async function getKanbanTaskData(listId: string) {
	const db = getDb();
	const [list] = await db.select().from(priorityRoomLists).where(eq(priorityRoomLists.id, listId)).limit(1);
	if (!list) throw new Error("Карточка Kanban не найдена.");

	const [items, comments, events, taskRemarks] = await Promise.all([
		db
			.select({
				id: cableListItems.id,
				cableId: cables.id,
				cableLabel: cables.cableLabel,
				cableJournal: cables.cableJournal,
				cableNumber: cables.cableNumber,
				progress: cables.progress,
				importedProgress: cableListItems.importedProgress,
			})
			.from(cableListItems)
			.innerJoin(cables, eq(cables.id, cableListItems.cableId))
			.where(eq(cableListItems.listId, listId))
			.orderBy(asc(cableListItems.sourceRowIndex)),
		db
			.select({
				id: taskComments.id,
				content: taskComments.content,
				createdAt: taskComments.createdAt,
				login: users.login,
			})
			.from(taskComments)
			.innerJoin(users, eq(users.id, taskComments.createdByUserId))
			.where(eq(taskComments.listId, listId))
			.orderBy(asc(taskComments.createdAt)),
		db
			.select({
				id: taskEvents.id,
				message: taskEvents.message,
				createdAt: taskEvents.createdAt,
				login: users.login,
			})
			.from(taskEvents)
			.leftJoin(users, eq(users.id, taskEvents.actorUserId))
			.where(eq(taskEvents.listId, listId))
			.orderBy(asc(taskEvents.createdAt)),
		db.select().from(remarks).where(eq(remarks.listId, listId)).orderBy(desc(remarks.createdAt)),
	]);

	return {
		list,
		items,
		comments: comments.map((comment) => ({ ...comment, createdAt: comment.createdAt.toISOString() })),
		events: events.map((event) => ({
			...event,
			login: event.login ?? "Система",
			createdAt: event.createdAt.toISOString(),
		})),
		remarks: taskRemarks.map((remark) => ({ ...remark, createdAt: remark.createdAt.toISOString() })),
	};
}

export async function getMyNotifications(session: AuthSession) {
	const db = getDb();
	const rows = await db
		.select()
		.from(notifications)
		.where(eq(notifications.userId, session.id))
		.orderBy(desc(notifications.createdAt))
		.limit(50);
	return rows.map((row) => ({
		...row,
		createdAt: row.createdAt.toISOString(),
		readAt: row.readAt?.toISOString() ?? null,
	}));
}

export async function getTaskRecipients() {
	const db = getDb();
	return db
		.select({ id: users.id, login: users.login, department: users.department })
		.from(users)
		.where(eq(users.status, "active"))
		.orderBy(asc(users.login));
}
