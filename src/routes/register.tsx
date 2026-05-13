import { createFileRoute, redirect } from "@tanstack/react-router";

import { RegisterForm } from "@/components/auth/register-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthBootstrapState } from "@/lib/auth/auth.functions";
import { PROJECT_NAME } from "@/lib/auth/shared";

export const Route = createFileRoute("/register")({
	beforeLoad: async ({ context }) => {
		if (context.auth) throw redirect({ to: "/app" });

		const bootstrapState = await getAuthBootstrapState();

		if (bootstrapState.hasSuperAdmin) throw redirect({ to: "/login" });
	},
	component: RegisterPage,
});

function RegisterPage() {
	return (
		<main className="flex min-h-svh items-center justify-center px-4 py-10">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Создание первого суперпользователя</CardTitle>
					<CardDescription>
						В {PROJECT_NAME} ещё нет аккаунта суперпользователя. Создайте первый профиль, чтобы получить
						доступ к управлению системой.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<RegisterForm />
				</CardContent>
			</Card>
		</main>
	);
}
