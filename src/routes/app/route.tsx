import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/app-shell";

export const Route = createFileRoute("/app")({
	beforeLoad: ({ context }) => {
		if (!context.auth) {
			throw redirect({ to: "/login" });
		}
	},
	component: AppLayout,
});

function AppLayout() {
	const { auth } = Route.useRouteContext();

	if (!auth) {
		return null;
	}

	return (
		<AppShell user={auth}>
			<Outlet />
		</AppShell>
	);
}
