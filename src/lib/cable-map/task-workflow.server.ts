import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import * as Xlsx from "xlsx";

import type { AuthSession, UserDepartment } from "@/lib/auth/shared";
import { getDb } from "@/lib/db";
import {
	cableListItems,
	cables,
	notifications,
	priorityRoomLists,
	remarkCableItems,
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
	RevertKanbanTaskEventInput,
	SplitKanbanTaskInput,
	TransitionKanbanTaskInput,
	UpdateTaskItemCompletionInput,
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

export function createImportableTaskMatches(matched: Array<{ parsed: ParsedTaskCable; cableId: string }>) {
	const matchesByCableId = new Map<string, { parsed: ParsedTaskCable; cableId: string }>();

	for (const match of matched) {
		if (!matchesByCableId.has(match.cableId)) {
			matchesByCableId.set(match.cableId, match);
		}
	}

	return {
		matches: [...matchesByCableId.values()],
		duplicateCount: matched.length - matchesByCableId.size,
	};
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
	const importable = createImportableTaskMatches(result.matched);

	return {
		fileName: file.name,
		totalCount: parsed.length,
		matchedCount: importable.matches.length,
		missing: result.missing.slice(0, 100),
		ambiguous: [
			...result.ambiguous,
			...Array.from({ length: importable.duplicateCount }, () => "Дубль найденного кабеля"),
		].slice(0, 100),
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

async function addTaskEvent(
	listId: string,
	eventType: string,
	message: string,
	actorUserId: string,
	payload: Record<string, unknown> = {}
) {
	const db = getDb();
	const [event] = await db
		.insert(taskEvents)
		.values({ listId, eventType, message, actorUserId, payload })
		.returning({ id: taskEvents.id });

	return event;
}

export async function importCableTaskListFromFormData(formData: FormData, session: AuthSession) {
	const { file, fileType, buffer } = await ensureUploadFile(formData);
	const stage = String(formData.get("stage") ?? "formed") as PriorityListKanbanStatus;
	const title = normalize(formData.get("title")) || file.name;
	const priority = normalize(formData.get("priority")) || "normal";
	const deadline = normalize(formData.get("deadline")) || null;
	if (!["high", "normal", "low"].includes(priority)) throw new Error("Неизвестный приоритет списка.");
	if (title.length > 240) throw new Error("Название списка не должно быть длиннее 240 символов.");

	if (!getAllowedImportStages(session).includes(stage)) {
		throw new Error("У вашей роли нет права добавить список в выбранный этап.");
	}

	const parsed = parseTaskCableRows(file.name, buffer);
	const result = await analyzeParsedTaskCables(parsed);
	const importable = createImportableTaskMatches(result.matched);
	const ambiguousCount = result.ambiguous.length + importable.duplicateCount;

	if (importable.matches.length === 0)
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
			matchedCount: importable.matches.length,
			missingCount: result.missing.length,
			ambiguousCount,
		};
	}

	const now = new Date();
	const recipientDepartment = stageRecipient[stage];
	const [list] = await db.transaction(async (tx) => {
		const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(priorityRoomLists);
		const taskCode = String(count + 1);
		const [created] = await tx
			.insert(priorityRoomLists)
			.values({
				authorName: session.login,
				fileName: file.name,
				fileType,
				title,
				priority,
				taskCode,
				deadline,
				roomCount: importable.matches.length,
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
			importable.matches.map(({ parsed: item, cableId }) => ({
				listId: created.id,
				cableId,
				sourceRowIndex: item.rowIndex,
				importedProgress: item.progress,
				createdAt: now,
			}))
		);

		for (const { parsed: item, cableId } of importable.matches) {
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
			payload: { toStatus: stage },
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
		matchedCount: importable.matches.length,
		missingCount: result.missing.length,
		ambiguousCount,
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
	if (input.action === "confirm")
		return { status: "adjustment" as const, department: "commissioning" as const };
	if (input.action === "return")
		return { status: "in_progress" as const, department: input.recipientDepartment ?? "skm" };
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
	if (input.action === "complete" && session.role !== "super-admin") {
		const [pendingItem] = await db
			.select({ id: cableListItems.id })
			.from(cableListItems)
			.where(and(eq(cableListItems.listId, list.id), eq(cableListItems.isCompleted, false)))
			.limit(1);
		if (pendingItem) throw new Error("Сначала отметьте выполненными все позиции списка.");
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
		session.id,
		{ fromStatus: list.status, toStatus: target.status, action: input.action }
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

export async function updateTaskItemCompletion(input: UpdateTaskItemCompletionInput, session: AuthSession) {
	const db = getDb();
	const [list] = await db
		.select({ status: priorityRoomLists.status, responsibleUserId: priorityRoomLists.responsibleUserId })
		.from(priorityRoomLists)
		.where(eq(priorityRoomLists.id, input.listId))
		.limit(1);
	if (!list) throw new Error("Карточка Kanban не найдена.");
	if (
		session.role !== "super-admin" &&
		(list.status !== "in_progress" || session.department !== "skm" || list.responsibleUserId !== session.id)
	) {
		throw new Error("Изменять позиции может только назначенный исполнитель СКМ.");
	}
	const now = new Date();
	const [updated] = await db
		.update(cableListItems)
		.set({
			isCompleted: input.isCompleted,
			completedAt: input.isCompleted ? now : null,
			completedByUserId: input.isCompleted ? session.id : null,
		})
		.where(and(eq(cableListItems.listId, input.listId), eq(cableListItems.cableId, input.cableId)))
		.returning({ id: cableListItems.id });
	if (!updated) throw new Error("Позиция не входит в этот список.");
	await addTaskEvent(
		input.listId,
		"item_completion",
		`${session.login} ${input.isCompleted ? "отметил выполненной" : "снял выполнение с"} позиции.`,
		session.id,
		{ cableId: input.cableId, isCompleted: input.isCompleted }
	);
	return updated;
}

export async function splitKanbanTask(input: SplitKanbanTaskInput, session: AuthSession) {
	const db = getDb();
	const [list] = await db
		.select()
		.from(priorityRoomLists)
		.where(eq(priorityRoomLists.id, input.listId))
		.limit(1);
	if (!list) throw new Error("Карточка Kanban не найдена.");
	if (
		session.role !== "super-admin" &&
		(list.status !== "curator_review" || !(session.department === "tai" || session.department === "curator"))
	) {
		throw new Error("Разделять список может только цех или куратор на этапе проверки.");
	}
	const items = await db.select().from(cableListItems).where(eq(cableListItems.listId, list.id));
	const rejected = [...new Set(input.rejectedCableIds)];
	if (!rejected.every((cableId) => items.some((item) => item.cableId === cableId))) {
		throw new Error("В список разделения попала позиция из другой карточки.");
	}
	const accepted = items.filter((item) => !rejected.includes(item.cableId));
	if (accepted.length === 0 || rejected.length === 0) {
		throw new Error("Для разделения должны остаться и принятые, и возвращённые позиции.");
	}
	const now = new Date();
	const [child] = await db.transaction(async (tx) => {
		const [{ childCount }] = await tx
			.select({ childCount: sql<number>`count(*)::int` })
			.from(priorityRoomLists)
			.where(eq(priorityRoomLists.parentListId, list.id));
		const taskCode = `${list.taskCode || list.id.slice(0, 8)}.${childCount + 2}`;
		const [created] = await tx
			.insert(priorityRoomLists)
			.values({
				authorName: list.authorName,
				fileName: list.fileName,
				fileType: list.fileType,
				title: list.title,
				priority: list.priority,
				taskCode,
				parentListId: list.id,
				deadline: list.deadline,
				roomCount: accepted.length,
				senderDepartment: list.senderDepartment,
				recipientDepartment: "commissioning",
				status: "adjustment",
				statusUpdatedByUserId: session.id,
				statusUpdatedAt: now,
				importedByUserId: list.importedByUserId,
				createdAt: now,
				updatedAt: now,
			})
			.returning({ id: priorityRoomLists.id });
		await tx.insert(cableListItems).values(
			accepted.map((item) => ({
				listId: created.id,
				cableId: item.cableId,
				sourceRowIndex: item.sourceRowIndex,
				importedProgress: item.importedProgress,
				isCompleted: item.isCompleted,
				completedAt: item.completedAt,
				completedByUserId: item.completedByUserId,
				createdAt: now,
			}))
		);
		await tx.delete(cableListItems).where(
			and(
				eq(cableListItems.listId, list.id),
				inArray(
					cableListItems.cableId,
					accepted.map((item) => item.cableId)
				)
			)
		);
		await tx
			.update(cableListItems)
			.set({ isCompleted: false, completedAt: null, completedByUserId: null })
			.where(and(eq(cableListItems.listId, list.id), inArray(cableListItems.cableId, rejected)));
		await tx
			.update(priorityRoomLists)
			.set({
				roomCount: rejected.length,
				status: "in_progress",
				recipientDepartment: "skm",
				statusUpdatedByUserId: session.id,
				statusUpdatedAt: now,
				updatedAt: now,
			})
			.where(eq(priorityRoomLists.id, list.id));
		await tx.insert(taskEvents).values([
			{
				listId: list.id,
				eventType: "split",
				message: `${session.login} вернул ${rejected.length} позиций на доработку и создал дочернюю часть.`,
				actorUserId: session.id,
				payload: { childListId: created.id, rejectedCableIds: rejected },
				createdAt: now,
			},
			{
				listId: created.id,
				eventType: "split_created",
				message: `${session.login} принял ${accepted.length} позиций из карточки ${list.taskCode || list.id.slice(0, 8)}.`,
				actorUserId: session.id,
				payload: { parentListId: list.id, acceptedCableIds: accepted.map((item) => item.cableId) },
				createdAt: now,
			},
		]);
		return [created];
	});
	if (input.remark) {
		await createKanbanRemark(
			{
				listId: list.id,
				cableIds: rejected,
				content: input.remark,
				assignedDepartment: "skm",
			},
			session
		);
	}
	await addDepartmentNotifications(
		"commissioning",
		child.id,
		"task_partially_accepted",
		"Вам передана принятая часть списка.",
		`task-split:${child.id}`,
		session.id
	);
	return child;
}

export async function revertKanbanTaskEvent(input: RevertKanbanTaskEventInput, session: AuthSession) {
	if (session.role !== "super-admin") throw new Error("Отменять действия может только администратор.");
	const db = getDb();
	const [event] = await db
		.select()
		.from(taskEvents)
		.where(and(eq(taskEvents.id, input.eventId), eq(taskEvents.listId, input.listId)))
		.limit(1);
	if (!event || event.revertedAt) throw new Error("Действие недоступно для отмены.");
	const payload = event.payload as {
		fromStatus?: PriorityListKanbanStatus;
		toStatus?: PriorityListKanbanStatus;
	};
	if (!payload.fromStatus || !payload.toStatus) throw new Error("Можно отменить только переход карточки.");
	const [list] = await db
		.select()
		.from(priorityRoomLists)
		.where(eq(priorityRoomLists.id, input.listId))
		.limit(1);
	if (!list || list.status !== payload.toStatus) {
		throw new Error("Переход уже перекрыт последующим действием и не может быть отменён точечно.");
	}
	const now = new Date();
	await db.transaction(async (tx) => {
		await tx
			.update(priorityRoomLists)
			.set({
				status: payload.fromStatus!,
				recipientDepartment: stageRecipient[payload.fromStatus!],
				statusUpdatedByUserId: session.id,
				statusUpdatedAt: now,
				updatedAt: now,
			})
			.where(eq(priorityRoomLists.id, input.listId));
		await tx
			.update(taskEvents)
			.set({ revertedAt: now, revertedByUserId: session.id })
			.where(eq(taskEvents.id, event.id));
		await tx.insert(taskEvents).values({
			listId: input.listId,
			eventType: "revert",
			message: `${session.login} отменил действие: ${event.message}`,
			actorUserId: session.id,
			payload: { revertedEventId: event.id, fromStatus: payload.toStatus, toStatus: payload.fromStatus },
			createdAt: now,
		});
	});
	return { id: input.listId, status: payload.fromStatus };
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

	const selectedCableIds = input.applyToAll
		? (
				await db
					.select({ cableId: cableListItems.cableId })
					.from(cableListItems)
					.where(eq(cableListItems.listId, input.listId))
			).map((item) => item.cableId)
		: [...new Set(input.cableIds ?? (input.cableId ? [input.cableId] : []))];
	if (selectedCableIds.length > 0) {
		const validItems = await db
			.select({ cableId: cableListItems.cableId })
			.from(cableListItems)
			.where(and(eq(cableListItems.listId, input.listId), inArray(cableListItems.cableId, selectedCableIds)));
		if (validItems.length !== selectedCableIds.length)
			throw new Error("Выбранная позиция не входит в этот список.");
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
			targetType: selectedCableIds.length > 0 ? "cable" : "priority_list",
			targetId: selectedCableIds[0] ?? input.listId,
			listId: input.listId,
			content: input.content,
			stage: (
				await db
					.select({ status: priorityRoomLists.status })
					.from(priorityRoomLists)
					.where(eq(priorityRoomLists.id, input.listId))
					.limit(1)
			)[0]?.status,
			assignedDepartment: input.assignedDepartment,
			assignedUserId: input.assignedUserId,
			createdByUserId: session.id,
		})
		.returning({ id: remarks.id });
	if (!remark) throw new Error("Не удалось создать замечание.");
	if (selectedCableIds.length > 0) {
		await db
			.insert(remarkCableItems)
			.values(selectedCableIds.map((cableId) => ({ remarkId: remark.id, cableId })))
			.onConflictDoNothing();
	}

	const event = await addTaskEvent(
		input.listId,
		"remark",
		`${session.login} создал замечание${selectedCableIds.length ? ` для ${selectedCableIds.length} позиций` : ""}.`,
		session.id,
		{ remarkId: remark.id, cableIds: selectedCableIds }
	);
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

export async function seedKanbanDemo(session: AuthSession) {
	if (session.role !== "super-admin")
		throw new Error("Демонстрационные списки может создавать только администратор.");
	await ensureCanonicalCableBase();
	const db = getDb();
	const base = await db.select({ id: cables.id }).from(cables).orderBy(asc(cables.externalKey)).limit(60);
	if (base.length < 60) throw new Error("Для демо требуется не менее 60 кабелей в генеральной базе.");
	const demo = [
		{ title: "Первый приоритет", priority: "high" },
		{ title: "Второй приоритет", priority: "normal" },
		{ title: "Третий приоритет", priority: "low" },
	] as const;
	const existing = await db
		.select({ sourceChecksum: priorityRoomLists.sourceChecksum })
		.from(priorityRoomLists)
		.where(
			inArray(
				priorityRoomLists.sourceChecksum,
				demo.map((_, index) => `kanban-demo:${index + 1}`)
			)
		);
	if (existing.length > 0) return { created: 0, message: "Демонстрационные списки уже существуют." };
	const now = new Date();
	await db.transaction(async (tx) => {
		const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(priorityRoomLists);
		for (const [index, item] of demo.entries()) {
			const [list] = await tx
				.insert(priorityRoomLists)
				.values({
					authorName: session.login,
					fileName: "База контроля кабеля (демо)",
					fileType: "xlsx",
					title: item.title,
					priority: item.priority,
					taskCode: String(count + index + 1),
					roomCount: 20,
					sourceChecksum: `kanban-demo:${index + 1}`,
					senderDepartment: "tai",
					recipientDepartment: "skm",
					status: "formed",
					statusUpdatedByUserId: session.id,
					statusUpdatedAt: now,
					importedByUserId: session.id,
					createdAt: now,
					updatedAt: now,
				})
				.returning({ id: priorityRoomLists.id });
			await tx.insert(cableListItems).values(
				base.slice(index * 20, index * 20 + 20).map((cable, sourceRowIndex) => ({
					listId: list.id,
					cableId: cable.id,
					sourceRowIndex: sourceRowIndex + 1,
					createdAt: now,
				}))
			);
			await tx.insert(taskEvents).values({
				listId: list.id,
				eventType: "created",
				message: `${session.login} создал демонстрационный список «${item.title}».`,
				actorUserId: session.id,
				payload: { toStatus: "formed", demo: true },
				createdAt: now,
			});
		}
	});
	return { created: 3, message: "Созданы три демонстрационных списка по 20 позиций." };
}

export async function getKanbanTaskData(listId: string) {
	const db = getDb();
	const [list] = await db.select().from(priorityRoomLists).where(eq(priorityRoomLists.id, listId)).limit(1);
	if (!list) throw new Error("Карточка Kanban не найдена.");

	const [items, comments, events, taskRemarks, children] = await Promise.all([
		db
			.select({
				id: cableListItems.id,
				cableId: cables.id,
				cableLabel: cables.cableLabel,
				cableJournal: cables.cableJournal,
				cableNumber: cables.cableNumber,
				progress: cables.progress,
				importedProgress: cableListItems.importedProgress,
				isCompleted: cableListItems.isCompleted,
				completedAt: cableListItems.completedAt,
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
				eventType: taskEvents.eventType,
				message: taskEvents.message,
				payload: taskEvents.payload,
				revertedAt: taskEvents.revertedAt,
				createdAt: taskEvents.createdAt,
				login: users.login,
			})
			.from(taskEvents)
			.leftJoin(users, eq(users.id, taskEvents.actorUserId))
			.where(eq(taskEvents.listId, listId))
			.orderBy(asc(taskEvents.createdAt)),
		db.select().from(remarks).where(eq(remarks.listId, listId)).orderBy(desc(remarks.createdAt)),
		db
			.select({
				id: priorityRoomLists.id,
				taskCode: priorityRoomLists.taskCode,
				title: priorityRoomLists.title,
				status: priorityRoomLists.status,
			})
			.from(priorityRoomLists)
			.where(eq(priorityRoomLists.parentListId, listId)),
	]);
	const parent = list.parentListId
		? await db
				.select({
					id: priorityRoomLists.id,
					taskCode: priorityRoomLists.taskCode,
					title: priorityRoomLists.title,
					status: priorityRoomLists.status,
				})
				.from(priorityRoomLists)
				.where(eq(priorityRoomLists.id, list.parentListId))
				.limit(1)
		: [];
	const remarkIds = taskRemarks.map((remark) => remark.id);
	const linkedCables = remarkIds.length
		? await db
				.select({ remarkId: remarkCableItems.remarkId, cableId: remarkCableItems.cableId })
				.from(remarkCableItems)
				.where(inArray(remarkCableItems.remarkId, remarkIds))
		: [];
	const cablesByRemark = new Map<string, string[]>();
	for (const linked of linkedCables)
		cablesByRemark.set(linked.remarkId, [...(cablesByRemark.get(linked.remarkId) ?? []), linked.cableId]);

	return {
		list,
		items: items.map((item) => ({ ...item, completedAt: item.completedAt?.toISOString() ?? null })),
		parent: parent[0] ?? null,
		children,
		comments: comments.map((comment) => ({ ...comment, createdAt: comment.createdAt.toISOString() })),
		events: events.map((event) => ({
			...event,
			payload: JSON.stringify(event.payload),
			login: event.login ?? "Система",
			createdAt: event.createdAt.toISOString(),
			revertedAt: event.revertedAt?.toISOString() ?? null,
		})),
		remarks: taskRemarks.map((remark) => ({
			...remark,
			cableIds: cablesByRemark.get(remark.id) ?? (remark.targetType === "cable" ? [remark.targetId] : []),
			createdAt: remark.createdAt.toISOString(),
		})),
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
