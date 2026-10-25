import { afterEach, expect, it } from "bun:test";

import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";

import { useNetworkStatus } from "./useNetworkStatus";

const original = navigator.onLine;
afterEach(() => {
	cleanup();
	Object.defineProperty(navigator, "onLine", { configurable: true, value: original });
});
function NetworkLabel() {
	return <span>{useNetworkStatus() ? "online" : "offline"}</span>;
}
it("renders the same server snapshot even when Bun navigator has no onLine", () => {
	Object.defineProperty(navigator, "onLine", { configurable: true, value: undefined });
	expect(renderToString(<NetworkLabel />)).toBe("<span>online</span>");
});
it("reads the real offline status after hydration and follows network events", () => {
	Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
	expect(renderToString(<NetworkLabel />)).toBe("<span>online</span>");
	const { result } = renderHook(useNetworkStatus);
	expect(result.current).toBe(false);
	act(() => {
		window.dispatchEvent(new Event("online"));
	});
	expect(result.current).toBe(true);
	act(() => {
		window.dispatchEvent(new Event("offline"));
	});
	expect(result.current).toBe(false);
});
