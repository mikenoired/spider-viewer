"use client";

import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import {
	CheckIcon,
	LoaderCircleIcon,
	ShieldCheckIcon,
	UserCogIcon,
	UserPlusIcon,
	UsersIcon,
	XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	approveUserRegistration,
	createManagedUser,
	rejectUserRegistration,
	updateManagedUserRole,
} from "@/lib/auth/auth.functions";
import type {
	AuthSession,
	CreateManagedUserInput,
	ManagedUserView,
	ManagedUsersView,
} from "@/lib/auth/shared";
import {
	assignableUserRoles,
	createManagedUserFieldsSchema,
	createManagedUserSchema,
	roleLabels,
	statusLabels,
} from "@/lib/auth/shared";
import { cn } from "@/lib/utils";

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

function toFieldErrors(errors: Array<unknown>) {
	return errors.flatMap((error) => {
		if (typeof error === "string") return [{ message: error }];

		if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
			return [{ message: error.message }];

		return [];
	});
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
	currentUser,
	emptyTitle,
	emptyDescription,
	actionSlot,
}: {
	users: ManagedUserView[];
	currentUser: AuthSession;
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
							<TableCell className="font-medium">
								<div className="flex items-center gap-2">
									<span>{user.login}</span>
									{user.id === currentUser.id ? <Badge variant="outline">Вы</Badge> : null}
								</div>
							</TableCell>
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

function CreateUserDialog({
	open,
	onOpenChange,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: () => Promise<void>;
}) {
	const [submitError, setSubmitError] = useState<string | null>(null);
	const defaultValues: CreateManagedUserInput = {
		login: "",
		password: "",
		confirmPassword: "",
		role: "user",
	};
	const form = useForm({
		defaultValues,
		validators: {
			onSubmit: createManagedUserSchema,
		},
		onSubmit: async ({ value }) => {
			setSubmitError(null);

			try {
				await createManagedUser({ data: value });
				toast.success("Пользователь создан.");
				form.reset();
				onOpenChange(false);
				await onCreated();
			} catch (error) {
				const message = error instanceof Error ? error.message : "Не удалось создать пользователя.";

				setSubmitError(message);
				toast.error(message);
			}
		},
	});

	useEffect(() => {
		if (!open) {
			setSubmitError(null);
		}
	}, [open]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form
					className="contents"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}>
					<DialogHeader>
						<DialogTitle>Создать пользователя</DialogTitle>
						<DialogDescription>
							Новый профиль сразу получает активный доступ. Роль можно изменить позже в списке активных
							пользователей.
						</DialogDescription>
					</DialogHeader>
					<FieldGroup>
						<form.Field name="login" validators={{ onBlur: createManagedUserFieldsSchema.shape.login }}>
							{(field) => {
								const errors = toFieldErrors(field.state.meta.errors);

								return (
									<Field data-invalid={errors.length > 0 || undefined}>
										<FieldLabel htmlFor={field.name}>Логин</FieldLabel>
										<Input
											id={field.name}
											name={field.name}
											autoComplete="username"
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
											aria-invalid={errors.length > 0}
										/>
										<FieldError errors={errors} />
									</Field>
								);
							}}
						</form.Field>
						<form.Field name="password" validators={{ onBlur: createManagedUserFieldsSchema.shape.password }}>
							{(field) => {
								const errors = toFieldErrors(field.state.meta.errors);

								return (
									<Field data-invalid={errors.length > 0 || undefined}>
										<FieldLabel htmlFor={field.name}>Пароль</FieldLabel>
										<Input
											id={field.name}
											name={field.name}
											type="password"
											autoComplete="new-password"
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
											aria-invalid={errors.length > 0}
										/>
										<FieldError errors={errors} />
									</Field>
								);
							}}
						</form.Field>
						<form.Field
							name="confirmPassword"
							validators={{ onBlur: createManagedUserFieldsSchema.shape.confirmPassword }}>
							{(field) => {
								const errors = toFieldErrors(field.state.meta.errors);

								return (
									<Field data-invalid={errors.length > 0 || undefined}>
										<FieldLabel htmlFor={field.name}>Повторите пароль</FieldLabel>
										<Input
											id={field.name}
											name={field.name}
											type="password"
											autoComplete="new-password"
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
											aria-invalid={errors.length > 0}
										/>
										<FieldError errors={errors} />
									</Field>
								);
							}}
						</form.Field>
						<form.Field name="role" validators={{ onBlur: createManagedUserFieldsSchema.shape.role }}>
							{(field) => {
								const errors = toFieldErrors(field.state.meta.errors);

								return (
									<Field data-invalid={errors.length > 0 || undefined}>
										<FieldLabel htmlFor={field.name}>Роль</FieldLabel>
										<select
											id={field.name}
											name={field.name}
											className={cn(
												"h-8 w-full rounded-lg border border-input bg-background px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
												errors.length > 0 &&
													"border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40"
											)}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.target.value as CreateManagedUserInput["role"])
											}
											aria-invalid={errors.length > 0}>
											{assignableUserRoles.map((role) => (
												<option key={role} value={role}>
													{roleLabels[role]}
												</option>
											))}
										</select>
										<FieldError errors={errors} />
									</Field>
								);
							}}
						</form.Field>
					</FieldGroup>
					{submitError ? <FieldError>{submitError}</FieldError> : null}
					<form.Subscribe
						selector={(state) => ({
							canSubmit: state.canSubmit,
							isSubmitting: state.isSubmitting,
						})}>
						{({ canSubmit, isSubmitting }) => (
							<DialogFooter>
								<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
									Отмена
								</Button>
								<Button type="submit" disabled={!canSubmit || isSubmitting}>
									{isSubmitting ? <Spinner data-icon="inline-start" /> : null}
									Создать
								</Button>
							</DialogFooter>
						)}
					</form.Subscribe>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function UserManagementPanel({
	data,
	currentUser,
	openCreateInitially = false,
}: {
	data: ManagedUsersView;
	currentUser: AuthSession;
	openCreateInitially?: boolean;
}) {
	const router = useRouter();
	const [activeAction, setActiveAction] = useState<string | null>(null);
	const [createOpen, setCreateOpen] = useState(openCreateInitially);
	const superAdminCount = data.active.filter((user) => user.role === "super-admin").length;

	useEffect(() => {
		if (openCreateInitially) setCreateOpen(true);
	}, [openCreateInitially]);

	async function refreshUsers() {
		await router.invalidate();
	}

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

			await refreshUsers();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось обновить статус пользователя.");
		} finally {
			setActiveAction(null);
		}
	}

	async function handleRoleChange(user: ManagedUserView, role: CreateManagedUserInput["role"]) {
		const actionKey = `role:${user.id}:${role}`;
		setActiveAction(actionKey);

		try {
			await updateManagedUserRole({
				data: {
					userId: user.id,
					role,
				},
			});
			toast.success("Роль пользователя обновлена.");
			await refreshUsers();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось обновить роль пользователя.");
		} finally {
			setActiveAction(null);
		}
	}

	return (
		<div className="flex flex-col gap-4 px-4 pb-4">
			<CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={refreshUsers} />

			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-[-0.03em]">Профили пользователей</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Просмотр всех аккаунтов, создание пользователей и назначение ролей.
					</p>
				</div>
				<Button type="button" onClick={() => setCreateOpen(true)}>
					<UserPlusIcon data-icon="inline-start" />
					Создать пользователя
				</Button>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<SummaryCard
					title="Ожидают подтверждения"
					value={String(data.pending.length)}
					description="Старые заявки до закрытия публичной регистрации"
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
					description="Имеют доступ к управлению профилями"
					icon={ShieldCheckIcon}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Управление доступом</CardTitle>
					<CardDescription>
						Создавать пользователей и назначать роли могут только суперпользователи. Публичная регистрация
						доступна только для создания первого суперпользователя в пустой системе.
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
								currentUser={currentUser}
								emptyTitle="Новых заявок нет"
								emptyDescription="Публичная регистрация закрыта после создания первого суперпользователя."
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
								currentUser={currentUser}
								emptyTitle="Активных пользователей пока нет"
								emptyDescription="Созданные суперпользователем профили появятся в этом разделе."
								actionSlot={(user) => {
									const nextRole = user.role === "super-admin" ? "user" : "super-admin";
									const actionKey = `role:${user.id}:${nextRole}`;
									const isBusy = activeAction === actionKey;
									const isLastSuperAdmin = user.role === "super-admin" && superAdminCount <= 1;

									return (
										<Button
											type="button"
											size="sm"
											variant={nextRole === "super-admin" ? "default" : "outline"}
											onClick={() => void handleRoleChange(user, nextRole)}
											disabled={isBusy || isLastSuperAdmin}>
											{isBusy ? (
												<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
											) : (
												<UserCogIcon data-icon="inline-start" />
											)}
											{nextRole === "super-admin" ? "Сделать супер" : "Сделать пользователем"}
										</Button>
									);
								}}
							/>
						</TabsContent>
						<TabsContent value="rejected" className="pt-4">
							<UserTable
								users={data.rejected}
								currentUser={currentUser}
								emptyTitle="Отклонённых заявок пока нет"
								emptyDescription="Список появится, если суперпользователь отклонит старую заявку."
							/>
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>
		</div>
	);
}
