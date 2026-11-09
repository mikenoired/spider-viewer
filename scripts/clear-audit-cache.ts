import { clearAuditCache } from "./clear-history";

try {
	await clearAuditCache();
} catch {
	process.stderr.write("Redis audit cache cleanup failed.\n");
	process.exitCode = 1;
}
