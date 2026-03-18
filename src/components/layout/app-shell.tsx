"use client";

import { Link, useRouterState } from "@tanstack/react-router";
import { HomeIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarRail,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import type { AuthSession } from "@/lib/auth/shared";
import { PROJECT_NAME, roleLabels } from "@/lib/auth/shared";
import { cn } from "@/lib/utils";
import { LogoutButton } from "./logout-button";
import { ThemeToggle } from "./theme-toggle";

export function AppShell({
	children,
	user,
}: {
	children: React.ReactNode;
	user: AuthSession;
}) {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});

	return (
		<SidebarProvider>
			<AppSidebar pathname={pathname} user={user} />
			<SidebarInset>
				<header className="flex h-14 items-center gap-3 border-b px-4">
					<SidebarTrigger />
					<Separator orientation="vertical" className="h-4" />
					<div className="text-sm font-medium">Главная страница</div>
				</header>
				<div className="flex flex-1 flex-col p-4">{children}</div>
			</SidebarInset>
		</SidebarProvider>
	);
}

function AppSidebar({
	pathname,
	user,
}: {
	pathname: string;
	user: AuthSession;
}) {
	return (
		<Sidebar collapsible="icon">
			<SidebarHeader className="border-b p-2">
				<Link
					to="/app"
					className={cn(
						"flex items-center gap-3 rounded-lg border bg-background px-2.5 py-2 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
						"group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0",
					)}
				>
					<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
						SV
					</div>
					<div className="min-w-0 group-data-[collapsible=icon]:hidden">
						<div className="truncate text-sm font-semibold">{PROJECT_NAME}</div>
						<div className="truncate text-xs text-muted-foreground">
							Рабочее пространство
						</div>
					</div>
				</Link>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Навигация</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton
									asChild
									isActive={pathname.startsWith("/app")}
									tooltip="Главная страница"
								>
									<Link to="/app">
										<HomeIcon />
										<span>Главная страница</span>
									</Link>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter className="border-t p-2">
				<div className="flex flex-col gap-2">
					<div
						className={cn(
							"flex items-center gap-3 rounded-lg border bg-background px-2.5 py-2",
							"group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
						)}
					>
						<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold">
							{getInitials(user.login)}
						</div>
						<div className="min-w-0 group-data-[collapsible=icon]:hidden">
							<div className="truncate text-sm font-medium">{user.login}</div>
							<Badge variant="secondary">{roleLabels[user.role]}</Badge>
						</div>
					</div>
					<div className="flex items-center gap-2 group-data-[collapsible=icon]:flex-col">
						<LogoutButton
							className="justify-start group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
							labelClassName="group-data-[collapsible=icon]:hidden"
						/>
						<ThemeToggle className="group-data-[collapsible=icon]:size-8" />
					</div>
				</div>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}

function getInitials(value: string) {
	return value.slice(0, 2).toUpperCase();
}
