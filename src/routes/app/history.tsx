import { createFileRoute, redirect } from "@tanstack/react-router"
import { format } from "date-fns"
import { HistoryPanel } from "@/components/cable-map/history-panel"
import { getHistory } from "@/lib/cable-map/functions"

function getTodayIso() {
	return format(new Date(), "yyyy-MM-dd")
}

export const Route = createFileRoute("/app/history")({
	beforeLoad: ({ context }) => {
		if (context.auth?.role !== "super-admin") throw redirect({ to: "/app" })
	},
	loader: async () => {
		const today = getTodayIso()

		return getHistory({
			data: {
				from: today,
				to: today,
			},
		})
	},
	component: HistoryPage,
})

function HistoryPage() {
	const entries = Route.useLoaderData()

	return (
		<HistoryPanel
			description="Все зафиксированные изменения прогресса по помещениям."
			initialEntries={entries}
		/>
	)
}
