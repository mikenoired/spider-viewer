"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
	const { resolvedTheme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const isDark = mounted && resolvedTheme === "dark";

	return (
		<Button
			type="button"
			variant="outline"
			size="icon-sm"
			className={cn(className)}
			onClick={() => setTheme(isDark ? "light" : "dark")}
			aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}>
			{isDark ? <SunIcon /> : <MoonIcon />}
		</Button>
	);
}

export function ThemeMenuItem({ className }: { className?: string }) {
	const { resolvedTheme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const isDark = mounted && resolvedTheme === "dark";

	return (
		<DropdownMenuItem className={cn(className)} onSelect={() => setTheme(isDark ? "light" : "dark")}>
			{isDark ? <SunIcon /> : <MoonIcon />}
			{isDark ? "Светлая тема" : "Тёмная тема"}
		</DropdownMenuItem>
	);
}
