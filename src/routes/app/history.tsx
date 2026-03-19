import { createFileRoute, redirect } from "@tanstack/react-router";
import { HistoryPanel } from "@/components/cable-map/history-panel";
import { getHistory } from "@/lib/cable-map/functions";

export const Route = createFileRoute("/app/history")({
	beforeLoad: ({ context }) => {
		if (context.auth?.role !== "super-admin") {
			throw redirect({ to: "/app" });
		}
	},
	loader: async () =>
		getHistory({
			data: {
				from: null,
				to: null,
			},
		}),
	component: HistoryPage,
});

function HistoryPage() {
	const entries = Route.useLoaderData();

	return (
		<HistoryPanel
			description="Все зафиксированные изменения прогресса по помещениям."
			initialEntries={entries}
		/>
	);
}
