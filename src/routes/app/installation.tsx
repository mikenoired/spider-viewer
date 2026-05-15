import { createFileRoute } from "@tanstack/react-router";

import { CableMapView } from "@/components/cable-map/cable-map-view";
import { canEditProgress, canManageManualRooms } from "@/lib/auth/shared";
import { getInstallationDashboardData } from "@/lib/cable-map/functions";

export const Route = createFileRoute("/app/installation")({
	loader: async () => getInstallationDashboardData(),
	component: InstallationPage,
});

function InstallationPage() {
	const data = Route.useLoaderData();
	const { auth } = Route.useRouteContext();

	if (!auth) return null;

	return (
		<CableMapView
			data={data}
			canEditProgress={canEditProgress(auth.role)}
			canManageManualRooms={canManageManualRooms(auth.role)}
			role={auth.role}
		/>
	);
}
