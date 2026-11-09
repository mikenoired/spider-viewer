import { open, rm } from "node:fs/promises";

import { sha256File } from "./backup-db";
import { getBackupPrefix, getStorageClient } from "./storage";

const [key, path, ...extra] = process.argv.slice(2);
let created = false;
try {
	if (!key?.startsWith(getBackupPrefix()) || !key.endsWith(".dump") || !path || extra.length)
		throw new Error("Usage: bun run db:download-backup <backup-key> <new-local-path>");
	if (await Bun.file(path).exists()) throw new Error("Destination already exists.");
	const storage = getStorageClient();
	const manifest = await storage.file(`${key}.json`).json();
	if (manifest.key !== key || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error("Invalid manifest.");
	const destination = await open(path, "wx", 0o600);
	created = true;
	try {
		await Bun.write(Bun.file(destination.fd), storage.file(key));
	} finally {
		await destination.close();
	}
	if (Bun.file(path).size !== manifest.bytes || (await sha256File(path)) !== manifest.sha256)
		throw new Error("Backup checksum mismatch.");
	process.stdout.write("Backup downloaded and SHA-256 verified.\n");
} catch {
	if (created) await rm(path, { force: true });
	process.stderr.write(
		"Backup download failed. Check key, manifest, S3 configuration and destination (must not exist).\n"
	);
	process.exitCode = 1;
}
