import { createFileRoute, redirect } from "@tanstack/react-router";

import { UserManagementPanel } from "@/components/auth/user-management-panel";
import { getManagedUsers } from "@/lib/auth/auth.functions";

export const Route = createFileRoute("/app/users")({
	beforeLoad: ({ context }) => {
		if (context.auth?.role !== "super-admin") throw redirect({ to: "/app" });
	},
	validateSearch: (search) => ({
		create: search.create === "1" || search.create === true,
	}),
	loader: async () => getManagedUsers(),
	component: UsersPage,
});

function UsersPage() {
	const data = Route.useLoaderData();
	const { auth } = Route.useRouteContext();
	const { create } = Route.useSearch();

	if (!auth) return null;

	return <UserManagementPanel data={data} currentUser={auth} openCreateInitially={create} />;
}
