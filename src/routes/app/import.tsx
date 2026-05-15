import { createFileRoute, redirect } from "@tanstack/react-router";

import { SnapshotImportForm } from "@/components/cable-map/snapshot-import-form";
import { InstallationImportForm } from "@/components/installation/installation-import-form";
import { getDashboardData, getInstallationDashboardData } from "@/lib/cable-map/functions";

export const Route = createFileRoute("/app/import")({
	beforeLoad: ({ context }) => {
		if (context.auth?.role !== "super-admin") throw redirect({ to: "/app" });
	},
	loader: async () => {
		const [dashboardData, installationData] = await Promise.all([
			getDashboardData(),
			getInstallationDashboardData(),
		]);

		return {
			dashboardData,
			installationData,
		};
	},
	component: ImportSnapshotPage,
});

function ImportSnapshotPage() {
	const data = Route.useLoaderData();

	return (
		<div className="flex flex-col gap-4">
			<SnapshotImportForm snapshot={data.dashboardData.snapshot} />
			<div className="px-4 pb-4">
				<InstallationImportForm snapshot={data.installationData.snapshot} />
			</div>
		</div>
	);
}
