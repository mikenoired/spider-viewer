"use client";

import { useEffect, useState } from "react";

function getInitialOnlineStatus() {
	if (typeof navigator === "undefined") return true;

	return navigator.onLine;
}

export function useNetworkStatus() {
	const [isOnline, setOnline] = useState(getInitialOnlineStatus);

	useEffect(() => {
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
