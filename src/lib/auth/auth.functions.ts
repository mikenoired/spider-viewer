import { createServerFn } from "@tanstack/react-start"
import { loginSchema } from "./shared"

export const getCurrentSession = createServerFn({ method: "GET" }).handler(async () => {
	const { getCurrentSession } = await import("./server")
	return getCurrentSession()
})

export const login = createServerFn({ method: "POST" })
	.inputValidator(loginSchema)
	.handler(async ({ data }) => {
		const { loginWithCredentials } = await import("./server")
		return loginWithCredentials(data)
	})

export const logout = createServerFn({ method: "POST" }).handler(async () => {
	const { logout } = await import("./server")
	await logout()

	return { success: true }
})
