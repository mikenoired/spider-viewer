"use client";

import { useRouter } from "@tanstack/react-router";
import { ClipboardListIcon, LoaderCircleIcon, MessageSquarePlusIcon, UserIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AuthSession, UserDepartment } from "@/lib/auth/shared";
import { departmentLabels } from "@/lib/auth/shared";
import {
	createKanbanRemark,
	createTaskComment,
	getKanbanTaskData,
	getMyNotifications,
	getTaskRecipients,
	transitionKanbanTask,
} from "@/lib/cable-map/functions";
import type { PriorityListKanbanStatus, PriorityRoomListView } from "@/lib/cable-map/shared";

const columns: Array<{ status: PriorityListKanbanStatus; title: string; description: string }> = [
	{ status: "formed", title: "Список сформирован", description: "ТАИ сформировал задачу" },
	{ status: "in_progress", title: "Список в работе", description: "СКМ выполняет работы" },
	{ status: "curator_review", title: "На проверку куратору", description: "Ожидает проверки ТАИ" },
	{ status: "adjustment", title: "Список в наладке", description: "Доработка или наладка" },
	{ status: "done", title: "Список выполнен", description: "Работы подтверждены" },
];

const departments: UserDepartment[] = ["tai", "skm", "commissioning", "curator"];

function getActions(list: PriorityRoomListView, session: AuthSession) {
	if (session.role === "super-admin")
		return columns
			.filter((column) => column.status !== list.status)
			.map((column) => ({ action: "move" as const, status: column.status, label: column.title }));
	if (session.department === "skm" && list.status === "formed")
		return [{ action: "accept" as const, label: "Взять в работу" }];
	if (
		session.department === "skm" &&
		list.status === "in_progress" &&
		list.responsibleLogin === session.login
	)
		return [{ action: "complete" as const, label: "Отметить выполненной" }];
	if ((session.department === "tai" || session.department === "curator") && list.status === "curator_review")
		return [
			{ action: "confirm" as const, label: "Подтвердить" },
			{ action: "return" as const, label: "Вернуть на доработку" },
		];
	if (session.department === "commissioning" && list.status === "adjustment")
		return [{ action: "move" as const, status: "curator_review" as const, label: "Передать на проверку" }];
	return [];
}

function ListCard({
	list,
	session,
	pending,
	onTransition,
	onOpen,
}: {
	list: PriorityRoomListView;
	session: AuthSession;
	pending: boolean;
	onTransition: (
		list: PriorityRoomListView,
		action: "move" | "accept" | "complete" | "confirm" | "return",
		status?: PriorityListKanbanStatus
	) => void;
	onOpen: (list: PriorityRoomListView) => void;
}) {
	const actions = getActions(list, session);
	return (
		<div id={`kanban-task-${list.id}`} className="rounded-lg border bg-background p-3 shadow-sm">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold">{list.fileName}</div>
					<div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
						<UserIcon className="size-3.5" />
						<span className="truncate">Автор: {list.authorName}</span>
					</div>
				</div>
				<Badge variant="outline" className="shrink-0">
					{list.roomCount}
				</Badge>
			</div>
			<div className="mt-2 grid gap-1 text-xs text-muted-foreground">
				<span>Отправитель: {departmentLabels[list.senderDepartment]}</span>
				<span>Получатель: {list.recipientDepartment ? departmentLabels[list.recipientDepartment] : "—"}</span>
				<span>Ответственный: {list.responsibleLogin ?? "не назначен"}</span>
				<span>
					Комментариев: {list.commentCount} · замечаний: {list.remarkCount}
				</span>
			</div>
			<div className="mt-3 flex flex-wrap gap-1">
				<Button type="button" size="sm" variant="secondary" onClick={() => onOpen(list)}>
					Открыть
				</Button>
				{actions.map((item) => (
					<Button
						key={`${item.action}:${item.status ?? ""}`}
						type="button"
						size="sm"
						variant="outline"
						disabled={pending}
						onClick={() => onTransition(list, item.action, item.status)}>
						{pending ? <LoaderCircleIcon className="animate-spin" /> : null}
						{item.label}
					</Button>
				))}
			</div>
		</div>
	);
}

function TaskDialog({ list, onClose }: { list: PriorityRoomListView | null; onClose: () => void }) {
	const router = useRouter();
	const [task, setTask] = useState<Awaited<ReturnType<typeof getKanbanTaskData>> | null>(null);
	const [recipients, setRecipients] = useState<Awaited<ReturnType<typeof getTaskRecipients>>>([]);
	const [comment, setComment] = useState("");
	const [remark, setRemark] = useState("");
	const [cableId, setCableId] = useState("");
	const [department, setDepartment] = useState<UserDepartment>("skm");
	const [assignedUserId, setAssignedUserId] = useState("");
	const [pending, setPending] = useState(false);

	useEffect(() => {
		if (!list) return;
		setTask(null);
		void Promise.all([getKanbanTaskData({ data: list.id }), getTaskRecipients()])
			.then(([nextTask, nextRecipients]) => {
				setTask(nextTask);
				setRecipients(nextRecipients);
			})
			.catch((error) => toast.error(error instanceof Error ? error.message : "Не удалось открыть карточку."));
	}, [list]);

	async function refresh() {
		if (!list) return;
		const nextTask = await getKanbanTaskData({ data: list.id });
		setTask(nextTask);
		await router.invalidate();
	}
	async function addComment() {
		if (!list || !comment.trim() || pending) return;
		setPending(true);
		try {
			await createTaskComment({ data: { listId: list.id, content: comment } });
			setComment("");
			await refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось сохранить комментарий.");
		} finally {
			setPending(false);
		}
	}
	async function addRemark() {
		if (!list || !remark.trim() || pending) return;
		setPending(true);
		try {
			await createKanbanRemark({
				data: {
					listId: list.id,
					cableId: cableId || undefined,
					content: remark,
					assignedDepartment: department,
					assignedUserId: assignedUserId || undefined,
				},
			});
			setRemark("");
			await refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось создать замечание.");
		} finally {
			setPending(false);
		}
	}

	return (
		<Dialog open={Boolean(list)} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{list?.fileName ?? "Карточка списка"}</DialogTitle>
					<DialogDescription>
						Состояние задачи, кабели, комментарии, замечания и история сохраняются на сервере.
					</DialogDescription>
				</DialogHeader>
				{task ? (
					<div className="grid gap-4">
						<div className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-2">
							<span>Статус: {columns.find((column) => column.status === task.list.status)?.title}</span>
							<span>Автор: {task.list.authorName}</span>
							<span>Отправитель: {departmentLabels[task.list.senderDepartment]}</span>
							<span>
								Получатель:{" "}
								{task.list.recipientDepartment ? departmentLabels[task.list.recipientDepartment] : "—"}
							</span>
						</div>
						<section className="grid gap-2">
							<h3 className="font-medium">Кабели ({task.items.length})</h3>
							<div className="max-h-56 overflow-auto rounded border">
								<table className="w-full text-xs">
									<thead>
										<tr className="border-b text-left">
											<th className="p-2">Кабель</th>
											<th className="p-2">Журнал / номер</th>
											<th className="p-2">Прогресс</th>
										</tr>
									</thead>
									<tbody>
										{task.items.map((item) => (
											<tr key={item.id} className="border-b last:border-0">
												<td className="p-2">{item.cableLabel}</td>
												<td className="p-2">
													{item.cableJournal} {item.cableNumber}
												</td>
												<td className="p-2">{item.progress}%</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</section>
						<section className="grid gap-2">
							<h3 className="font-medium">Комментарий</h3>
							<textarea
								className="min-h-20 rounded-md border bg-background p-2"
								value={comment}
								onChange={(event) => setComment(event.target.value)}
								placeholder="Напишите комментарий к списку"
							/>
							<Button
								type="button"
								className="w-fit"
								disabled={!comment.trim() || pending}
								onClick={() => void addComment()}>
								Добавить комментарий
							</Button>
							{task.comments.map((item) => (
								<div key={item.id} className="rounded border p-2 text-sm">
									<b>{item.login}</b> · {new Date(item.createdAt).toLocaleString("ru-RU")}
									<div>{item.content}</div>
								</div>
							))}
						</section>
						<section className="grid gap-2">
							<h3 className="font-medium">Новое замечание</h3>
							<textarea
								className="min-h-20 rounded-md border bg-background p-2"
								value={remark}
								onChange={(event) => setRemark(event.target.value)}
								placeholder="Опишите проблему"
							/>
							<div className="grid gap-2 sm:grid-cols-3">
								<select
									className="h-9 rounded-md border bg-background px-2"
									value={cableId}
									onChange={(event) => setCableId(event.target.value)}>
									<option value="">На весь список</option>
									{task.items.map((item) => (
										<option key={item.cableId} value={item.cableId}>
											{item.cableLabel}
										</option>
									))}
								</select>
								<select
									className="h-9 rounded-md border bg-background px-2"
									value={department}
									onChange={(event) => setDepartment(event.target.value as UserDepartment)}>
									{departments.map((item) => (
										<option key={item} value={item}>
											{departmentLabels[item]}
										</option>
									))}
								</select>
								<select
									className="h-9 rounded-md border bg-background px-2"
									value={assignedUserId}
									onChange={(event) => setAssignedUserId(event.target.value)}>
									<option value="">Всем подразделениям</option>
									{recipients
										.filter((item) => item.department === department)
										.map((item) => (
											<option key={item.id} value={item.id}>
												{item.login}
											</option>
										))}
								</select>
							</div>
							<Button
								type="button"
								className="w-fit"
								disabled={!remark.trim() || pending}
								onClick={() => void addRemark()}>
								<MessageSquarePlusIcon />
								Создать замечание
							</Button>
							{task.remarks.map((item) => (
								<div key={item.id} className="rounded border p-2 text-sm">
									{item.content}
								</div>
							))}
						</section>
						<section className="grid gap-2">
							<h3 className="font-medium">История</h3>
							{task.events.map((item) => (
								<div key={item.id} className="text-sm text-muted-foreground">
									{new Date(item.createdAt).toLocaleString("ru-RU")} — {item.message}
								</div>
							))}
						</section>
					</div>
				) : (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<LoaderCircleIcon className="animate-spin" />
						Загружаем карточку…
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

export function InstallationKanbanBoard({
	lists,
	session,
}: {
	lists: PriorityRoomListView[];
	session: AuthSession;
}) {
	const router = useRouter();
	const [pendingListId, setPendingListId] = useState<string | null>(null);
	const [selectedList, setSelectedList] = useState<PriorityRoomListView | null>(null);
	const [notifications, setNotifications] = useState<Awaited<ReturnType<typeof getMyNotifications>>>([]);
	const listsByStatus = useMemo(
		() =>
			Object.fromEntries(
				columns.map((column) => [column.status, lists.filter((list) => list.status === column.status)])
			) as Record<PriorityListKanbanStatus, PriorityRoomListView[]>,
		[lists]
	);

	useEffect(() => {
		void getMyNotifications()
			.then(setNotifications)
			.catch(() => undefined);
	}, []);

	useEffect(() => {
		const taskId = window.location.hash.replace("#kanban-task-", "");
		if (!taskId || taskId === window.location.hash) return;
		const target = lists.find((list) => list.id === taskId);
		if (target) setSelectedList(target);
	}, [lists]);

	async function transition(
		list: PriorityRoomListView,
		action: "move" | "accept" | "complete" | "confirm" | "return",
		status?: PriorityListKanbanStatus
	) {
		if (pendingListId) return;
		setPendingListId(list.id);
		try {
			await transitionKanbanTask({ data: { listId: list.id, action, status } });
			await router.invalidate();
			toast.success("Статус задачи обновлён.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось изменить статус задачи.");
		} finally {
			setPendingListId(null);
		}
	}

	return (
		<>
			<Card id="kanban">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<ClipboardListIcon className="size-4" />
						Kanban списков кабелей
					</CardTitle>
					<CardDescription>
						Доска хранит задачи независимо от активного снимка карты. Переходы дополнительно проверяются на
						сервере по роли и подразделению.
					</CardDescription>
					{notifications.length > 0 ? (
						<div className="mt-2 grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
							<div className="font-medium">Уведомления</div>
							{notifications.slice(0, 5).map((notification) => {
								const target = notification.listId
									? lists.find((list) => list.id === notification.listId)
									: null;

								return target ? (
									<Button
										key={notification.id}
										type="button"
										variant="ghost"
										className="h-auto justify-start whitespace-normal px-0 text-left"
										onClick={() => setSelectedList(target)}>
										{notification.message}
									</Button>
								) : (
									<div key={notification.id}>{notification.message}</div>
								);
							})}
						</div>
					) : null}
				</CardHeader>
				<CardContent>
					<div className="grid gap-3 2xl:grid-cols-5">
						{columns.map((column) => (
							<div key={column.status} className="flex min-h-72 flex-col rounded-lg border bg-muted/20">
								<div className="border-b p-3">
									<div className="flex items-start justify-between gap-2 text-sm font-semibold">
										<span>{column.title}</span>
										<Badge variant="secondary">{listsByStatus[column.status].length}</Badge>
									</div>
									<div className="mt-1 text-xs text-muted-foreground">{column.description}</div>
								</div>
								<div className="grid flex-1 content-start gap-2 p-3">
									{listsByStatus[column.status].map((list) => (
										<ListCard
											key={list.id}
											list={list}
											session={session}
											pending={pendingListId === list.id}
											onTransition={transition}
											onOpen={setSelectedList}
										/>
									))}
									{listsByStatus[column.status].length === 0 ? (
										<div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
											Пока пусто.
										</div>
									) : null}
								</div>
							</div>
						))}
					</div>
				</CardContent>
			</Card>
			<TaskDialog list={selectedList} onClose={() => setSelectedList(null)} />
		</>
	);
}
