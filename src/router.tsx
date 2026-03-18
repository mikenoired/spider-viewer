import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { AppProviders } from "@/components/app-providers";
import type { AuthSession } from "@/lib/auth/shared";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,
		context: {
			auth: null as AuthSession | null,
		},
		Wrap: AppProviders,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
