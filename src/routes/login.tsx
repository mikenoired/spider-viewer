import { createFileRoute, redirect } from "@tanstack/react-router";

import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthBootstrapState } from "@/lib/auth/auth.functions";
import { PROJECT_NAME } from "@/lib/auth/shared";

export const Route = createFileRoute("/login")({
	beforeLoad: async ({ context }) => {
		if (context.auth) throw redirect({ to: "/app" });

		const bootstrapState = await getAuthBootstrapState();

		if (!bootstrapState.hasSuperAdmin) throw redirect({ to: "/register" });
	},
	component: LoginPage,
});

function LoginPage() {
	return (
		<main className="flex min-h-svh items-center justify-center px-4 py-10">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Вход в {PROJECT_NAME}</CardTitle>
					<CardDescription>Авторизуйтесь через логин и пароль, выданные суперпользователем.</CardDescription>
				</CardHeader>
				<CardContent>
					<LoginForm />
				</CardContent>
			</Card>
		</main>
	);
}
