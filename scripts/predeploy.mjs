#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const requiredEnvironmentVariables = ["DATABASE_URL", "AUTH_SUPERUSERS_JSON"];
const drizzleKitBin = "./node_modules/.bin/drizzle-kit";

function assertRequiredEnvironment() {
	const missingVariables = requiredEnvironmentVariables.filter((name) => !process.env[name]);

	if (missingVariables.length > 0) {
		throw new Error(`Missing required predeploy env: ${missingVariables.join(", ")}.`);
	}
}

function assertRuntimeFiles() {
	if (!existsSync(drizzleKitBin)) {
		throw new Error(
			"drizzle-kit binary is missing. Check production dependencies copied into runtime image."
		);
	}

	if (!existsSync("./scripts/seed-superusers.mjs")) {
		throw new Error("seed-superusers.mjs is missing from the runtime image.");
	}
}

function runCommand(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			shell: false,
		});

		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? `exit code ${code}`}.`));
		});
	});
}

async function runPredeploy() {
	assertRequiredEnvironment();
	assertRuntimeFiles();

	process.stdout.write("[predeploy] Applying database schema\n");
	await runCommand(drizzleKitBin, ["push", "--verbose"]);

	process.stdout.write("[predeploy] Seeding configured superusers\n");
	await runCommand("node", ["./scripts/seed-superusers.mjs"]);

	process.stdout.write("[predeploy] Complete\n");
}

try {
	await runPredeploy();
} catch (error) {
	process.stderr.write(`[predeploy] ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
}
