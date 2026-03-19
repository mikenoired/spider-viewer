import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginForm } from "@/components/auth/login-form";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { PROJECT_NAME } from "@/lib/auth/shared";

export const Route = createFileRoute("/login")({
	beforeLoad: ({ context }) => {
		if (context.auth) throw redirect({ to: "/app" });
	},
	component: LoginPage,
});

function LoginPage() {
	return (
		<main className="flex min-h-svh items-center justify-center px-4 py-10">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>Вход в {PROJECT_NAME}</CardTitle>
					<CardDescription>
						Авторизуйтесь через логин и пароль, чтобы открыть рабочее
						пространство.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<LoginForm />
				</CardContent>
			</Card>
		</main>
	);
}
