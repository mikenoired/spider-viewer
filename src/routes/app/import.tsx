import { createFileRoute, redirect } from "@tanstack/react-router"
import { SnapshotImportForm } from "@/components/cable-map/snapshot-import-form"
import { getDashboardData } from "@/lib/cable-map/functions"

export const Route = createFileRoute("/app/import")({
	beforeLoad: ({ context }) => {
		if (context.auth?.role !== "super-admin") throw redirect({ to: "/app" })
	},
	loader: async () => getDashboardData(),
	component: ImportSnapshotPage,
})

function ImportSnapshotPage() {
	const data = Route.useLoaderData()

	return <SnapshotImportForm snapshot={data.snapshot} />
}
