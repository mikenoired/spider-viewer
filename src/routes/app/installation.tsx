import { createFileRoute } from "@tanstack/react-router";

import { InstallationBoard } from "@/components/installation/installation-board";
import { canEditInstallation } from "@/lib/auth/shared";
import { getInstallationBoardData } from "@/lib/installation/functions";
import type { InstallationBoardData } from "@/lib/installation/shared";

function createInstallationFallbackData(): InstallationBoardData {
	return {
		snapshot: null,
		columns: {
			not_started: [],
			in_progress: [],
			done: [],
		},
		processingGroups: [],
	};
}

export const Route = createFileRoute("/app/installation")({
	loader: async () => {
		try {
			return await getInstallationBoardData();
		} catch {
			return createInstallationFallbackData();
		}
	},
	component: InstallationPage,
});

function InstallationPage() {
	const data = Route.useLoaderData();
	const { auth } = Route.useRouteContext();

	if (!auth) return null;

	return <InstallationBoard initialData={data} canEdit={canEditInstallation(auth.role)} />;
}
