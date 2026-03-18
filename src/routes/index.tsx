import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	beforeLoad: ({ context }) => {
		throw redirect({ to: context.auth ? "/app" : "/login" });
	},
	component: IndexRedirect,
});

function IndexRedirect() {
	return null;
}
