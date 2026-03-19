import { createFileRoute, redirect } from "@tanstack/react-router";
import { HistoryPanel } from "@/components/cable-map/history-panel";
import { getBackdatedHistory } from "@/lib/cable-map/functions";

export const Route = createFileRoute("/app/backdated")({
	beforeLoad: ({ context }) => {
		if (context.auth?.role !== "super-admin") {
			throw redirect({ to: "/app" });
		}
	},
	loader: async () =>
		getBackdatedHistory({
			data: {
				from: null,
				to: null,
			},
		}),
	component: BackdatedPage,
});

function BackdatedPage() {
	const entries = Route.useLoaderData();

	return (
		<HistoryPanel
			description="Отдельный журнал записей, где дата действия не совпадает с фактическим моментом изменения."
			initialEntries={entries}
			backdatedOnly
		/>
	);
}
