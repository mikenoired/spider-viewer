import { createFileRoute } from "@tanstack/react-router";
import { CableMapView } from "@/components/cable-map/cable-map-view";
import { canEditProgress } from "@/lib/auth/shared";
import { getDashboardData } from "@/lib/cable-map/functions";

export const Route = createFileRoute("/app/")({
	loader: async () => getDashboardData(),
	component: AppHomePage,
});

function AppHomePage() {
	const data = Route.useLoaderData();
	const { auth } = Route.useRouteContext();

	if (!auth) {
		return null;
	}

	return (
		<CableMapView
			data={data}
			canEdit={canEditProgress(auth.role)}
			role={auth.role}
		/>
	);
}
