export function getStorageClient() {
	const names = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
	if (names.some((name) => !process.env[name])) {
		throw new Error(`Configure ${names.join(", ")} before using S3.`);
	}
	const endpoint = new URL(process.env.S3_ENDPOINT!);
	const virtualHostedStyle = process.env.S3_FORCE_PATH_STYLE !== "true";
	// Bun treats a custom virtual-hosted endpoint as complete and ignores `bucket`.
	if (virtualHostedStyle && !endpoint.hostname.startsWith(`${process.env.S3_BUCKET}.`))
		endpoint.hostname = `${process.env.S3_BUCKET}.${endpoint.hostname}`;
	return new Bun.S3Client({
		endpoint: endpoint.toString(),
		bucket: process.env.S3_BUCKET,
		accessKeyId: process.env.S3_ACCESS_KEY_ID,
		secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
		region: process.env.S3_REGION || "auto",
		virtualHostedStyle,
	});
}

export function getBackupPrefix() {
	const prefix = process.env.S3_BACKUP_PREFIX;
	if (!prefix || !/^backups\/[a-zA-Z0-9_-]+\/$/.test(prefix)) {
		throw new Error("S3_BACKUP_PREFIX must be backups/<environment>/ (for example backups/production/).");
	}
	return prefix;
}
