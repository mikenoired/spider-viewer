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
import { Spinner } from "@/components/ui/spinner";
import { logout } from "@/lib/auth/auth.functions";
import { cn } from "@/lib/utils";

export function LogoutButton({ className, labelClassName }: { className?: string; labelClassName?: string }) {
	const [pending, setPending] = useState(false);
	const navigate = useNavigate();
	const router = useRouter();

	async function handleLogout() {
		setPending(true);

		try {
			await logout();
			await router.invalidate();
			await navigate({ to: "/login" });
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось выйти из аккаунта.");
		} finally {
			setPending(false);
		}
	}

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button type="button" variant="outline" className={cn(className)}>
					<LogOutIcon data-icon="inline-start" />
					<span className={cn(labelClassName)}>Выйти</span>
				</Button>
			</AlertDialogTrigger>
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
					<AlertDialogAction onClick={handleLogout} disabled={pending}>
						{pending ? <Spinner data-icon="inline-start" /> : null}
						Подтвердить
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
