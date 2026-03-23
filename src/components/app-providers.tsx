"use client"

import { ThemeProvider } from "next-themes"
import { useEffect } from "react"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

function normalizeFetchInput(input: RequestInfo | URL) {
	if (typeof input === "string") {
		if (input.startsWith("/")) {
			return new URL(input, window.location.origin).toString()
		}

		try {
			const url = new URL(input)

			if (url.username || url.password) {
				url.username = ""
				url.password = ""
				return url.toString()
			}
		} catch {
			return input
		}

		return input
	}

	if (input instanceof URL) {
		const url = new URL(input.toString())

		if (url.username || url.password) {
			url.username = ""
			url.password = ""
			return url.toString()
		}

		return url.toString()
	}

	return input
}

export function AppProviders({ children }: { children: React.ReactNode }) {
	useEffect(() => {
		const originalFetch = window.fetch.bind(window)

		window.fetch = ((input, init) =>
			originalFetch(normalizeFetchInput(input), init)) as typeof window.fetch

		return () => {
			window.fetch = originalFetch
		}
	}, [])

	return (
		<ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="theme">
			<TooltipProvider>
				{children}
				<Toaster />
			</TooltipProvider>
		</ThemeProvider>
	)
}
