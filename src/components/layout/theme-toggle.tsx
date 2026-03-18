"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
			aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
		>
			{isDark ? <SunIcon /> : <MoonIcon />}
		</Button>
	);
}
