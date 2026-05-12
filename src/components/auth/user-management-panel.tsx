"use client";

import { useRouter } from "@tanstack/react-router";
import { CheckIcon, LoaderCircleIcon, ShieldCheckIcon, UserPlusIcon, UsersIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { approveUserRegistration, rejectUserRegistration } from "@/lib/auth/auth.functions";
import type { ManagedUserView, ManagedUsersView } from "@/lib/auth/shared";
import { roleLabels, statusLabels } from "@/lib/auth/shared";

function formatDateTime(value: string | null) {
	if (!value) return "Не рассмотрено";

	return new Intl.DateTimeFormat("ru-RU", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function getStatusBadgeVariant(status: ManagedUserView["status"]) {
	if (status === "active") return "secondary";
	if (status === "rejected") return "destructive";
	return "outline";
}

function EmptyTableState({ title, description }: { title: string; description: string }) {
	return (
		<div className="rounded-2xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
			<div className="font-medium text-foreground">{title}</div>
			<div className="mt-1">{description}</div>
		</div>
	);
}

function SummaryCard({
	title,
	value,
	description,
	icon: Icon,
}: {
	title: string;
	value: string;
	description: string;
	icon: typeof UsersIcon;
}) {
	return (
		<Card>
			<CardContent className="flex items-start justify-between gap-3 pt-6">
				<div>
					<div className="text-sm text-muted-foreground">{title}</div>
					<div className="mt-2 text-3xl font-semibold tracking-[-0.03em]">{value}</div>
					<div className="mt-1 text-sm text-muted-foreground">{description}</div>
				</div>
				<div className="rounded-2xl border bg-muted/30 p-3 text-muted-foreground">
					<Icon />
				</div>
			</CardContent>
		</Card>
	);
}

function UserTable({
	users,
	emptyTitle,
	emptyDescription,
	actionSlot,
}: {
	users: ManagedUserView[];
	emptyTitle: string;
	emptyDescription: string;
	actionSlot?: (user: ManagedUserView) => ReactNode;
}) {
	if (users.length === 0) {
		return <EmptyTableState title={emptyTitle} description={emptyDescription} />;
	}

	return (
		<div className="rounded-2xl border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Логин</TableHead>
						<TableHead>Роль</TableHead>
						<TableHead>Статус</TableHead>
						<TableHead>Зарегистрирован</TableHead>
						<TableHead>Рассмотрен</TableHead>
						<TableHead className="text-right">Действия</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{users.map((user) => (
						<TableRow key={user.id}>
							<TableCell className="font-medium">{user.login}</TableCell>
							<TableCell>
								<Badge variant={user.role === "super-admin" ? "default" : "secondary"}>
									{roleLabels[user.role]}
								</Badge>
							</TableCell>
							<TableCell>
								<Badge variant={getStatusBadgeVariant(user.status)}>{statusLabels[user.status]}</Badge>
							</TableCell>
							<TableCell>{formatDateTime(user.createdAt)}</TableCell>
							<TableCell>{formatDateTime(user.reviewedAt)}</TableCell>
							<TableCell className="text-right">{actionSlot?.(user) ?? "—"}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

export function UserManagementPanel({ data }: { data: ManagedUsersView }) {
	const router = useRouter();
	const [activeAction, setActiveAction] = useState<string | null>(null);
	const superAdminCount = data.active.filter((user) => user.role === "super-admin").length;

	async function handleModeration(userId: string, action: "approve" | "reject") {
		const actionKey = `${action}:${userId}`;
		setActiveAction(actionKey);

		try {
			if (action === "approve") {
				await approveUserRegistration({
					data: {
						userId,
					},
				});
				toast.success("Заявка подтверждена.");
			} else {
				await rejectUserRegistration({
					data: {
						userId,
					},
				});
				toast.success("Заявка отклонена.");
			}

			await router.invalidate();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось обновить статус пользователя.");
		} finally {
			setActiveAction(null);
		}
	}

	return (
		<div className="flex flex-col gap-4 px-4 pb-4">
			<div className="grid gap-4 md:grid-cols-3">
				<SummaryCard
					title="Ожидают подтверждения"
					value={String(data.pending.length)}
					description="Новые регистрации обычных пользователей"
					icon={UserPlusIcon}
				/>
				<SummaryCard
					title="Активные пользователи"
					value={String(data.active.length)}
					description="Могут входить в систему"
					icon={UsersIcon}
				/>
				<SummaryCard
					title="Суперпользователи"
					value={String(superAdminCount)}
					description="Имеют право редактирования и подтверждения"
					icon={ShieldCheckIcon}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Управление доступом</CardTitle>
					<CardDescription>
						Открытая регистрация создаёт только обычных пользователей. Суперпользователи создаются отдельно
						через `AUTH_SUPERUSERS_JSON` и `bun run auth:seed:superusers`.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Tabs defaultValue={data.pending.length > 0 ? "pending" : "active"}>
						<TabsList>
							<TabsTrigger value="pending">Ожидают</TabsTrigger>
							<TabsTrigger value="active">Активные</TabsTrigger>
							<TabsTrigger value="rejected">Отклонённые</TabsTrigger>
						</TabsList>
						<TabsContent value="pending" className="pt-4">
							<UserTable
								users={data.pending}
								emptyTitle="Новых заявок пока нет"
								emptyDescription="Когда пользователь зарегистрируется, заявка появится в этом списке."
								actionSlot={(user) => {
									const approveKey = `approve:${user.id}`;
									const rejectKey = `reject:${user.id}`;
									const isApproving = activeAction === approveKey;
									const isRejecting = activeAction === rejectKey;
									const isBusy = isApproving || isRejecting;

									return (
										<div className="flex items-center justify-end gap-2">
											<Button
												type="button"
												size="sm"
												onClick={() => void handleModeration(user.id, "approve")}
												disabled={isBusy}>
												{isApproving ? (
													<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
												) : (
													<CheckIcon data-icon="inline-start" />
												)}
												Подтвердить
											</Button>
											<Button
												type="button"
												size="sm"
												variant="destructive"
												onClick={() => void handleModeration(user.id, "reject")}
												disabled={isBusy}>
												{isRejecting ? (
													<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
												) : (
													<XIcon data-icon="inline-start" />
												)}
												Отклонить
											</Button>
										</div>
									);
								}}
							/>
						</TabsContent>
						<TabsContent value="active" className="pt-4">
							<UserTable
								users={data.active}
								emptyTitle="Активных пользователей пока нет"
								emptyDescription="После подтверждения пользователи появятся в этом разделе."
							/>
						</TabsContent>
						<TabsContent value="rejected" className="pt-4">
							<UserTable
								users={data.rejected}
								emptyTitle="Отклонённых заявок пока нет"
								emptyDescription="Список появится, если суперпользователь отклонит запрос на регистрацию."
							/>
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>
		</div>
	);
}
