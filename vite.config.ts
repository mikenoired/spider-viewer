import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
	plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
	resolve: { tsconfigPaths: true },
	server: { host: true },
	test: {
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		exclude: ["node_modules/**", "spider-viewer/**"],
	},
});

export default config;
