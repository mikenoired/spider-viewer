import { createFileRoute, redirect } from "@tanstack/react-router";
import { format } from "date-fns";

import { HistoryPanel } from "@/components/cable-map/history-panel";
import { getBackdatedHistory } from "@/lib/cable-map/functions";

function getTodayIso() {
	return format(new Date(), "yyyy-MM-dd");
}

export const Route = createFileRoute("/app/backdated")({
	beforeLoad: ({ context }) => {
		if (context.auth?.role !== "super-admin") throw redirect({ to: "/app" });
	},
	loader: async () => {
		const today = getTodayIso();

		return getBackdatedHistory({
			data: {
				from: today,
				to: today,
			},
		});
	},
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
