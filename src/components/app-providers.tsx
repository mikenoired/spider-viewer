"use client"

import { ThemeProvider } from "next-themes"
import { useEffect } from "react"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

function hasUrlCredentials(url: URL) {
	return url.username !== "" || url.password !== ""
}

function sanitizeUrlString(url: URL) {
	if (!hasUrlCredentials(url)) {
		return url.toString()
	}

	const sanitizedUrl = new URL(url.toString())
	sanitizedUrl.username = ""
	sanitizedUrl.password = ""
	return sanitizedUrl.toString()
}

function normalizeStringFetchInput(input: string) {
	if (input.startsWith("/")) {
		return new URL(input, window.location.origin).toString()
	}

	try {
		return sanitizeUrlString(new URL(input))
	} catch {
		return input
	}
}

function normalizeFetchInput(input: RequestInfo | URL) {
	if (typeof input === "string") {
		return normalizeStringFetchInput(input)
	}

	if (input instanceof URL) {
		return sanitizeUrlString(input)
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
