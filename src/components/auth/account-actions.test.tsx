// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ManagedUserView } from "@/lib/auth/shared";

const api = vi.hoisted(() => ({
	changeOwnPassword: vi.fn(),
	deleteManagedUser: vi.fn(),
	updateManagedUserLogin: vi.fn(),
	updateManagedUserPassword: vi.fn(),
	invalidate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: api.invalidate }) }));
vi.mock("@/lib/auth/auth.functions", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import { ChangePasswordDialog, ManagedUserActions } from "./account-actions";

const user: ManagedUserView = {
	id: "00000000-0000-4000-8000-000000000001",
	login: "worker",
	role: "user",
	department: "skm",
	status: "active",
	createdAt: new Date().toISOString(),
	reviewedAt: null,
};
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
describe("account action forms", () => {
	it("hides deletion for super-admins but permits editing their credentials", () => {
		render(<ManagedUserActions user={{ ...user, role: "super-admin" }} />);
		expect(screen.queryByRole("button", { name: "Удалить" })).toBeNull();
		expect(screen.getByRole("button", { name: "Логин" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Пароль" })).toBeDefined();
	});
	it("requires confirmation before deleting and refreshes the list on success", async () => {
		api.deleteManagedUser.mockResolvedValue({ success: true });
		render(<ManagedUserActions user={user} />);
		fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
		expect(api.deleteManagedUser).not.toHaveBeenCalled();
		expect(screen.getByRole("dialog").textContent).toContain("История работ сохранится");
		fireEvent.click(screen.getByRole("button", { name: "Удалить аккаунт" }));
		await waitFor(() => expect(api.invalidate).toHaveBeenCalledOnce());
		expect(api.deleteManagedUser).toHaveBeenCalledWith({ data: { userId: user.id } });
	});
	it("validates matching passwords before sending self change and displays server errors", async () => {
		api.changeOwnPassword.mockRejectedValue(new Error("Текущий пароль неверен."));
		render(<ChangePasswordDialog open onOpenChange={vi.fn()} />);
		fireEvent.change(screen.getByLabelText("Текущий пароль"), { target: { value: "OldPassword123" } });
		fireEvent.change(screen.getByLabelText("Новый пароль"), { target: { value: "NewPassword456" } });
		fireEvent.change(screen.getByLabelText("Повторите новый пароль"), { target: { value: "Mismatch123" } });
		fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
		expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Пароли не совпадают.");
		expect(api.changeOwnPassword).not.toHaveBeenCalled();
		fireEvent.change(screen.getByLabelText("Повторите новый пароль"), {
			target: { value: "NewPassword456" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
		await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Текущий пароль неверен."));
		expect(api.changeOwnPassword).toHaveBeenCalledWith({
			data: {
				currentPassword: "OldPassword123",
				password: "NewPassword456",
				confirmPassword: "NewPassword456",
			},
		});
	});
	it("clears password values on reopening the form", () => {
		const onOpenChange = vi.fn();
		const view = render(<ChangePasswordDialog open onOpenChange={onOpenChange} />);
		fireEvent.change(screen.getByLabelText("Новый пароль"), { target: { value: "SecretPassword123" } });
		view.rerender(<ChangePasswordDialog open={false} onOpenChange={onOpenChange} />);
		view.rerender(<ChangePasswordDialog open onOpenChange={onOpenChange} />);
		expect(screen.getByLabelText("Новый пароль")).toHaveProperty("value", "");
	});
});
