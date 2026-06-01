import { createFileRoute } from "@tanstack/react-router";

import { InstallationBoard } from "@/components/installation/installation-board";
import { canEditInstallation } from "@/lib/auth/shared";
import { getInstallationBoardData } from "@/lib/installation/functions";

export const Route = createFileRoute("/app/installation")({
	loader: async () => getInstallationBoardData(),
	component: InstallationPage,
});

function InstallationPage() {
	const data = Route.useLoaderData();
	const { auth } = Route.useRouteContext();

	if (!auth) return null;

	return <InstallationBoard initialData={data} canEdit={canEditInstallation(auth.role)} />;
}
