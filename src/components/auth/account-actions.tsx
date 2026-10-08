"use client";

import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	changeOwnPassword,
	deleteManagedUser,
	updateManagedUserLogin,
	updateManagedUserPassword,
} from "@/lib/auth/auth.functions";
import {
	changeOwnPasswordSchema,
	updateManagedUserLoginSchema,
	updateManagedUserPasswordSchema,
} from "@/lib/auth/shared";
import type { ManagedUserView } from "@/lib/auth/shared";

type AccountAction = "login" | "password" | "own-password" | "delete";

export function ManagedUserActions({ user }: { user: ManagedUserView }) {
	const [action, setAction] = useState<AccountAction | null>(null);
	return (
		<>
			<Button type="button" size="sm" variant="outline" onClick={() => setAction("login")}>
				Логин
			</Button>
			<Button type="button" size="sm" variant="outline" onClick={() => setAction("password")}>
				Пароль
			</Button>
			{user.role !== "super-admin" ? (
				<Button type="button" size="sm" variant="destructive" onClick={() => setAction("delete")}>
					Удалить
				</Button>
			) : null}
			{action ? <AccountActionDialog action={action} user={user} onClose={() => setAction(null)} /> : null}
		</>
	);
}

export function ChangePasswordDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return open ? <AccountActionDialog action="own-password" onClose={() => onOpenChange(false)} /> : null;
}

function AccountActionDialog({
	action,
	user,
	onClose,
}: {
	action: AccountAction;
	user?: ManagedUserView;
	onClose: () => void;
}) {
	const router = useRouter();
	const [login, setLogin] = useState(user?.login ?? "");
	const [currentPassword, setCurrentPassword] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const titles: Record<AccountAction, string> = {
		"login": "Изменить логин",
		"password": "Задать новый пароль",
		"own-password": "Сменить пароль",
		"delete": "Удалить аккаунт?",
	};
	const isPassword = action === "password" || action === "own-password";

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (pending) return;
		setError(null);
		setPending(true);
		try {
			let requiresLogin = false;
			if (action === "own-password") {
				const result = await changeOwnPassword({
					data: changeOwnPasswordSchema.parse({ currentPassword, password, confirmPassword }),
				});
				requiresLogin = result.requiresLogin;
			} else if (user) {
				if (action === "login") {
					const result = await updateManagedUserLogin({
						data: updateManagedUserLoginSchema.parse({ userId: user.id, login }),
					});
					requiresLogin = result.requiresLogin;
				} else if (action === "password") {
					const result = await updateManagedUserPassword({
						data: updateManagedUserPasswordSchema.parse({ userId: user.id, password, confirmPassword }),
					});
					requiresLogin = result.requiresLogin;
				} else {
					await deleteManagedUser({ data: { userId: user.id } });
				}
			}
			toast.success(
				action === "delete"
					? "Аккаунт удалён."
					: requiresLogin
						? "Данные сохранены. Войдите снова."
						: "Данные сохранены."
			);
			if (requiresLogin) {
				window.location.assign("/login");
				return;
			}
			onClose();
			await router.invalidate();
		} catch (err) {
			const message =
				err && typeof err === "object" && "issues" in err && Array.isArray(err.issues)
					? err.issues.map((issue: { message: string }) => issue.message).join(" ")
					: err instanceof Error
						? err.message
						: "Не удалось сохранить изменения.";
			setError(message);
			setPending(false);
		}
	}

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}>
			<DialogContent showCloseButton={!pending}>
				<form className="contents" onSubmit={submit}>
					<DialogHeader>
						<DialogTitle>{titles[action]}</DialogTitle>
						<DialogDescription>
							{action === "delete"
								? `Аккаунт «${user?.login}» потеряет доступ к системе. История работ сохранится, логин останется занят.`
								: action === "own-password"
									? "После смены пароля потребуется повторный вход на всех устройствах."
									: `Аккаунт: ${user?.login}. После изменения прежние сессии этого пользователя будут завершены.`}
						</DialogDescription>
					</DialogHeader>
					{action === "login" ? (
						<Field>
							<FieldLabel htmlFor="account-login">Новый логин</FieldLabel>
							<Input
								id="account-login"
								value={login}
								onChange={(event) => setLogin(event.target.value)}
								minLength={3}
								maxLength={32}
								autoComplete="username"
								required
								disabled={pending}
							/>
						</Field>
					) : null}
					{action === "own-password" ? (
						<Field>
							<FieldLabel htmlFor="account-current-password">Текущий пароль</FieldLabel>
							<Input
								id="account-current-password"
								type="password"
								value={currentPassword}
								onChange={(event) => setCurrentPassword(event.target.value)}
								autoComplete="current-password"
								required
								maxLength={128}
								disabled={pending}
							/>
						</Field>
					) : null}
					{isPassword ? (
						<>
							<Field>
								<FieldLabel htmlFor="account-password">Новый пароль</FieldLabel>
								<Input
									id="account-password"
									type="password"
									value={password}
									onChange={(event) => setPassword(event.target.value)}
									autoComplete="new-password"
									minLength={8}
									maxLength={128}
									required
									disabled={pending}
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="account-confirm-password">Повторите новый пароль</FieldLabel>
								<Input
									id="account-confirm-password"
									type="password"
									value={confirmPassword}
									onChange={(event) => setConfirmPassword(event.target.value)}
									autoComplete="new-password"
									minLength={8}
									maxLength={128}
									required
									disabled={pending}
								/>
							</Field>
						</>
					) : null}
					{error ? <FieldError role="alert">{error}</FieldError> : null}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose} disabled={pending}>
							Отмена
						</Button>
						<Button
							type="submit"
							variant={action === "delete" ? "destructive" : "default"}
							disabled={pending}>
							{pending ? "Сохранение…" : action === "delete" ? "Удалить аккаунт" : "Сохранить"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
