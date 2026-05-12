"use client";

import { useNavigate, useRouter } from "@tanstack/react-router";
import { LogOutIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { logout } from "@/lib/auth/auth.functions";
import { cn } from "@/lib/utils";

export function LogoutButton({ className }: { className?: string }) {
	const { handleLogout, pending } = useLogoutAction();

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button type="button" variant="destructive" size="icon" className={cn(className)}>
					<LogOutIcon />
				</Button>
			</AlertDialogTrigger>
			<LogoutDialogContent pending={pending} onConfirm={handleLogout} />
		</AlertDialog>
	);
}

export function LogoutMenuItem({
	className,
	onBeforeOpen,
}: {
	className?: string;
	onBeforeOpen?: () => void;
}) {
	const [open, setOpen] = useState(false);
	const { handleLogout, pending } = useLogoutAction(() => setOpen(false));

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<DropdownMenuItem
				variant="destructive"
				className={cn(className)}
				onSelect={(event) => {
					event.preventDefault();
					onBeforeOpen?.();
					window.requestAnimationFrame(() => setOpen(true));
				}}>
				<LogOutIcon />
				Выйти из аккаунта
			</DropdownMenuItem>
			<LogoutDialogContent pending={pending} onConfirm={handleLogout} />
		</AlertDialog>
	);
}

function useLogoutAction(onSuccess?: () => void) {
	const [pending, setPending] = useState(false);
	const navigate = useNavigate();
	const router = useRouter();

	async function handleLogout() {
		setPending(true);

		try {
			await logout();
			onSuccess?.();
			await router.invalidate();
			await navigate({ to: "/login" });
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось выйти из аккаунта.");
		} finally {
			setPending(false);
		}
	}

	return { handleLogout, pending };
}

function LogoutDialogContent({ pending, onConfirm }: { pending: boolean; onConfirm: () => Promise<void> }) {
	return (
		<AlertDialogContent>
			<AlertDialogHeader>
				<AlertDialogMedia>
					<TriangleAlertIcon />
				</AlertDialogMedia>
				<AlertDialogTitle>Выйти из аккаунта?</AlertDialogTitle>
				<AlertDialogDescription>
					Текущая сессия будет завершена. Для повторного входа потребуется авторизация через форму логина.
				</AlertDialogDescription>
			</AlertDialogHeader>
			<AlertDialogFooter>
				<AlertDialogCancel disabled={pending}>Отмена</AlertDialogCancel>
				<AlertDialogAction onClick={onConfirm} disabled={pending}>
					{pending ? <Spinner data-icon="inline-start" /> : null}
					Подтвердить
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialogContent>
	);
}
