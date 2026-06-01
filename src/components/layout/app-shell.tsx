"use client";

import { Link, useRouterState } from "@tanstack/react-router";
import {
	ChevronsUpDownIcon,
	FileClockIcon,
	FileSpreadsheetIcon,
	HistoryIcon,
	KanbanIcon,
	MapIcon,
	PanelLeftIcon,
	UserCheckIcon,
	UserPlusIcon,
	UsersIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { canManageUsers, canUploadSnapshot, canViewAudit, PROJECT_NAME, roleLabels } from "@/lib/auth/shared";
import { cn } from "@/lib/utils";

import { LogoutConfirmDialog, LogoutMenuItem } from "./logout-button";
import { ThemeMenuItem } from "./theme-toggle";

type AppShellChromeContextValue = {
	isChromeHidden: boolean;
	setChromeHidden: (hidden: boolean) => void;
};

const AppShellChromeContext = createContext<AppShellChromeContextValue | null>(null);
const accountCacheKey = "spider-viewer:account";

export function useAppShellChrome() {
	const context = useContext(AppShellChromeContext);

	if (!context) {
		throw new Error("useAppShellChrome must be used within AppShell.");
	}

	return context;
}

export function AppShell({ children, user }: { children: React.ReactNode; user: AuthSession }) {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
	const [chromeHidden, setChromeHidden] = useState(false);
	const chromeContextValue = useMemo(
		() => ({
			isChromeHidden: chromeHidden,
			setChromeHidden,
		}),
		[chromeHidden]
	);

	useEffect(() => {
		window.localStorage.setItem(
			accountCacheKey,
			JSON.stringify({
				id: user.id,
				login: user.login,
				role: user.role,
			})
		);
	}, [user]);

	return (
		<AppShellChromeContext.Provider value={chromeContextValue}>
			<SidebarProvider>
				<AppSidebar pathname={pathname} user={user} chromeHidden={chromeHidden} />
				<SidebarInset className="min-w-0 [--app-shell-content-padding:1rem] [--app-shell-header-height:calc(1.5rem+env(safe-area-inset-top))] [--app-shell-sidebar-offset:0px] md:peer-data-[state=collapsed]:[--app-shell-sidebar-offset:var(--sidebar-width-icon)] md:peer-data-[state=expanded]:[--app-shell-sidebar-offset:var(--sidebar-width)]">
					<header
						aria-hidden={chromeHidden}
						inert={chromeHidden ? true : undefined}
						className={cn(
							"fixed top-0 right-0 left-0 z-50 flex h-[calc(2.5rem+env(safe-area-inset-top))] items-center gap-2 border-b bg-background/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur-sm transition-[opacity,transform] duration-300 ease-out md:left-(--app-shell-sidebar-offset)",
							chromeHidden && "pointer-events-none -translate-y-full opacity-0"
						)}>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="md:hidden"
							onClick={() => setMobileNavigationOpen(true)}
							aria-label="Открыть навигацию">
							<PanelLeftIcon />
						</Button>
						<SidebarTrigger className="hidden md:inline-flex" />
						<div className="min-w-0 flex-1 text-sm font-medium">{getPageTitle(pathname)}</div>
						{canManageUsers(user.role) ? <ApprovalAccountsButton pathname={pathname} /> : null}
					</header>
					<div className="flex min-w-0 flex-1 flex-col pt-[calc(var(--app-shell-header-height)+var(--app-shell-content-padding))]">
						{children}
					</div>
					<MobileNavigationSheet
						pathname={pathname}
						user={user}
						open={mobileNavigationOpen}
						onOpenChange={setMobileNavigationOpen}
					/>
				</SidebarInset>
			</SidebarProvider>
		</AppShellChromeContext.Provider>
	);
}

function AppSidebar({
	pathname,
	user,
	chromeHidden,
}: {
	pathname: string;
	user: AuthSession;
	chromeHidden: boolean;
}) {
	const items = getNavigationItems(user.role);

	return (
		<Sidebar
			collapsible="icon"
			aria-hidden={chromeHidden}
			inert={chromeHidden ? true : undefined}
			className={cn(
				"z-50 transition-[opacity,transform] duration-300 ease-out",
				chromeHidden && "pointer-events-none -translate-x-6 opacity-0"
			)}>
			<SidebarHeader className="border-b p-2">
				<Link
					to="/app"
					className={cn(
						"flex items-center gap-3 rounded-lg transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
						"group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center"
					)}>
					<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
						SV
					</div>
					<div className="min-w-0 group-data-[collapsible=icon]:hidden">
						<div className="truncate text-sm font-semibold">{PROJECT_NAME}</div>
						<div className="truncate text-xs text-muted-foreground">Рабочее пространство</div>
					</div>
				</Link>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Навигация</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu className="gap-1">
							{items.map((item) => (
								<SidebarMenuItem key={item.to}>
									<SidebarMenuButton
										asChild
										isActive={item.to === "/app" ? pathname === "/app" : pathname.startsWith(item.to)}
										tooltip={item.label}>
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
			<SidebarFooter>
				<SidebarUserMenu user={user} />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}

function MobileNavigationSheet({
	pathname,
	user,
	open,
	onOpenChange,
}: {
	pathname: string;
	user: AuthSession;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const items = getNavigationItems(user.role);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="left"
				showCloseButton={false}
				className="flex w-[min(88vw,20rem)] flex-col gap-0 p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-none">
				<SheetHeader className="gap-1 border-b px-4 py-4 pt-[calc(env(safe-area-inset-top)+1rem)] text-left">
					<SheetTitle>{PROJECT_NAME}</SheetTitle>
					<SheetDescription>Навигация по рабочему пространству</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col">
					<div className="min-h-0 flex-1 overflow-auto px-3 py-3">
						<nav className="flex flex-col gap-1">
							{items.map((item) => (
								<Button
									key={item.to}
									asChild
									variant={
										item.to === "/app"
											? pathname === "/app"
												? "secondary"
												: "ghost"
											: pathname.startsWith(item.to)
												? "secondary"
												: "ghost"
									}
									className="h-11 justify-start px-3">
									<Link to={item.to} onClick={() => onOpenChange(false)}>
										<item.icon />
										<span>{item.label}</span>
									</Link>
								</Button>
							))}
						</nav>
					</div>

					<div className="border-t px-3 py-3">
						<SidebarUserMenu user={user} mobile />
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}

function SidebarUserMenu({ user, mobile = false }: { user: AuthSession; mobile?: boolean }) {
	const [open, setOpen] = useState(false);
	const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

	function handleLogoutSelect() {
		setOpen(false);
		window.requestAnimationFrame(() => setLogoutConfirmOpen(true));
	}

	return (
		<>
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						className={cn(
							"h-auto w-full justify-start gap-3 rounded-lg px-2! py-2 text-left hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
							mobile
								? "min-h-11 border bg-muted/20"
								: "group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
						)}
						aria-label="Меню пользователя">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold">
							{getInitials(user.login)}
						</div>
						<div className={cn("min-w-0 flex-1", !mobile && "group-data-[collapsible=icon]:hidden")}>
							<div className="truncate text-sm font-medium">{user.login}</div>
						</div>
						<ChevronsUpDownIcon
							data-icon="inline-end"
							className={cn(
								"ml-auto text-muted-foreground",
								!mobile && "group-data-[collapsible=icon]:hidden"
							)}
						/>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					side="right"
					align="end"
					className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
					<DropdownMenuLabel className="px-2 py-2">
						<div className="flex items-center gap-3">
							<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold">
								{getInitials(user.login)}
							</div>
							<div className="min-w-0">
								<div className="truncate text-sm font-medium text-foreground">{user.login}</div>
								<div className="mt-1">
									<Badge variant="secondary">{roleLabels[user.role]}</Badge>
								</div>
							</div>
						</div>
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<ThemeMenuItem />
					</DropdownMenuGroup>
					{canManageUsers(user.role) ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								<DropdownMenuItem asChild onSelect={() => setOpen(false)}>
									<Link to="/app/users" search={{ create: true }}>
										<UserPlusIcon />
										Создать пользователя
									</Link>
								</DropdownMenuItem>
								<DropdownMenuItem asChild onSelect={() => setOpen(false)}>
									<Link to="/app/users">
										<UsersIcon />
										Управление профилями
									</Link>
								</DropdownMenuItem>
							</DropdownMenuGroup>
						</>
					) : null}
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<LogoutMenuItem onSelect={handleLogoutSelect} />
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			<LogoutConfirmDialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen} />
		</>
	);
}

function ApprovalAccountsButton({ pathname }: { pathname: string }) {
	const isUsersPage = pathname.startsWith("/app/users");

	return (
		<>
			<Button
				asChild
				variant={isUsersPage ? "secondary" : "outline"}
				size="sm"
				className="hidden sm:inline-flex">
				<Link to="/app/users">
					<UserCheckIcon data-icon="inline-start" />
					Подтверждение учёток
				</Link>
			</Button>
			<Button asChild variant={isUsersPage ? "secondary" : "outline"} size="icon-sm" className="sm:hidden">
				<Link to="/app/users" aria-label="Подтверждение учётных записей">
					<UserCheckIcon />
				</Link>
			</Button>
		</>
	);
}

function getInitials(value: string) {
	return value.slice(0, 2).toUpperCase();
}

function getNavigationItems(role: AuthSession["role"]) {
	const items: Array<{
		to: "/app" | "/app/installation" | "/app/import" | "/app/history" | "/app/backdated" | "/app/users";
		label: string;
		icon: typeof MapIcon;
	}> = [
		{
			to: "/app" as const,
			label: "Карта демонтажа",
			icon: MapIcon,
		},
		{
			to: "/app/installation" as const,
			label: "Монтаж",
			icon: KanbanIcon,
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
			}
		);
	}

	if (canManageUsers(role)) {
		items.push({
			to: "/app/users" as const,
			label: "Пользователи",
			icon: UsersIcon,
		});
	}

	return items;
}

function getPageTitle(pathname: string) {
	return (
		[
			["/app/import", "Загрузка данных"],
			["/app/installation", "Монтаж"],
			["/app/history", "История изменений"],
			["/app/backdated", "Изменения задним числом"],
			["/app/users", "Пользователи"],
		].find(([path]) => pathname.startsWith(path))?.[1] ?? "Карта демонтажа"
	);
}
