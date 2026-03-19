"use client";

import { Link, useRouterState } from "@tanstack/react-router";
import {
	FileClockIcon,
	FileSpreadsheetIcon,
	HistoryIcon,
	MapIcon,
} from "lucide-react";
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
import {
	canUploadSnapshot,
	canViewAudit,
	PROJECT_NAME,
	roleLabels,
} from "@/lib/auth/shared";
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
			<SidebarInset className="[--app-shell-content-padding:1rem] [--app-shell-header-height:3.5rem] [--app-shell-sidebar-offset:0px] md:peer-data-[state=collapsed]:[--app-shell-sidebar-offset:var(--sidebar-width-icon)] md:peer-data-[state=expanded]:[--app-shell-sidebar-offset:var(--sidebar-width)]">
				<header className="fixed top-0 right-0 left-0 z-50 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur-sm md:left-(--app-shell-sidebar-offset)">
					<SidebarTrigger />
					<Separator orientation="vertical" className="h-4" />
					<div className="text-sm font-medium">{getPageTitle(pathname)}</div>
				</header>
				<div className="flex flex-1 flex-col pb-(--app-shell-content-padding) pt-[calc(var(--app-shell-header-height)+var(--app-shell-content-padding))]">
					{children}
				</div>
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
	const items = getNavigationItems(user.role);

	return (
		<Sidebar collapsible="icon" className="z-50">
			<SidebarHeader className="border-b p-2">
				<Link
					to="/app"
					className={cn(
						"flex items-center gap-3 rounded-lg transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
						"group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center",
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
							{items.map((item) => (
								<SidebarMenuItem key={item.to}>
									<SidebarMenuButton
										asChild
										isActive={
											item.to === "/app"
												? pathname === "/app"
												: pathname.startsWith(item.to)
										}
										tooltip={item.label}
									>
										<Link to={item.to}>
											<item.icon />
											<span>{item.label}</span>
										</Link>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter className="border-t p-2">
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<div
							className={cn(
								"flex items-center gap-3",
								"group-data-[collapsible=icon]:justify-center",
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
						<LogoutButton
							className="justify-start group-data-[collapsible=icon]:hidden"
							labelClassName="group-data-[collapsible=icon]:hidden"
						/>
					</div>
					<ThemeToggle className="group-data-[collapsible=icon]:size-8" />
				</div>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}

function getInitials(value: string) {
	return value.slice(0, 2).toUpperCase();
}

function getNavigationItems(role: AuthSession["role"]) {
	const items: Array<{
		to: "/app" | "/app/import" | "/app/history" | "/app/backdated";
		label: string;
		icon: typeof MapIcon;
	}> = [
		{
			to: "/app" as const,
			label: "Карта демонтажа",
			icon: MapIcon,
		},
	];

	if (canUploadSnapshot(role)) {
		items.push({
			to: "/app/import" as const,
			label: "Загрузка данных",
			icon: FileSpreadsheetIcon,
		});
	}

	if (canViewAudit(role)) {
		items.push(
			{
				to: "/app/history" as const,
				label: "История",
				icon: HistoryIcon,
			},
			{
				to: "/app/backdated" as const,
				label: "Задним числом",
				icon: FileClockIcon,
			},
		);
	}

	return items;
}

function getPageTitle(pathname: string) {
	if (pathname.startsWith("/app/import")) {
		return "Загрузка данных";
	}

	if (pathname.startsWith("/app/history")) {
		return "История изменений";
	}

	if (pathname.startsWith("/app/backdated")) {
		return "Изменения задним числом";
	}

	return "Карта демонтажа";
}
