import { createFileRoute } from "@tanstack/react-router";

import { RemarksPanel } from "@/components/cable-map/remarks-panel";
import { getRemarksData } from "@/lib/cable-map/functions";

export const Route = createFileRoute("/app/remarks")({
	loader: async () => getRemarksData(),
	component: RemarksPage,
});

function RemarksPage() {
	const data = Route.useLoaderData();
	const { auth } = Route.useRouteContext();
	if (!auth) return null;
	return <RemarksPanel data={data} canManage={auth.role === "super-admin"} />;
}
