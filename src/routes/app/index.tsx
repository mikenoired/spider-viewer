import { createFileRoute } from "@tanstack/react-router";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/app/")({
	component: AppHomePage,
});

function AppHomePage() {
	return (
		<div className="flex flex-1 flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle>Главная страница</CardTitle>
					<CardDescription>
						Базовая защищённая зона приложения для дальнейшей разработки
						функционала.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-2">
					<p>
						Авторизация через форму подключена и работает через cookie-сессию.
					</p>
					<p>
						Роли пользователей уже заведены: пользователь, админ и супер-админ.
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
