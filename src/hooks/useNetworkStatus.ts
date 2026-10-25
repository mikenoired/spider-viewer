"use client";

import { useEffect, useState } from "react";

export function useNetworkStatus() {
	const [isOnline, setOnline] = useState(true);

	useEffect(() => {
		// Keep the server and hydration snapshot identical; Bun has navigator without onLine.
		setOnline(navigator.onLine !== false);
		function handleOnline() {
			setOnline(true);
		}

		function handleOffline() {
			setOnline(false);
		}

		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);

		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, []);

	return isOnline;
}
