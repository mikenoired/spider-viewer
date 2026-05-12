import { createFileRoute, redirect } from "@tanstack/react-router";

import { RegisterForm } from "@/components/auth/register-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PROJECT_NAME } from "@/lib/auth/shared";

export const Route = createFileRoute("/register")({
	beforeLoad: ({ context }) => {
		if (context.auth) throw redirect({ to: "/app" });
	},
	component: RegisterPage,
});

function RegisterPage() {
	return (
		<main className="flex min-h-svh items-center justify-center px-4 py-10">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Регистрация в {PROJECT_NAME}</CardTitle>
					<CardDescription>
						После отправки заявки суперпользователь должен подтвердить доступ. До подтверждения вход в систему
						будет недоступен.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<RegisterForm />
				</CardContent>
			</Card>
		</main>
	);
}
