import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const SCRYPT_KEY_LENGTH = 64;

export async function hashPassword(password: string) {
	const salt = randomBytes(16).toString("hex");
	const derivedKey = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;

	return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
	const [salt, expectedHash] = storedHash.split(":");

	if (!salt || !expectedHash) return false;

	const derivedKey = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
	const expectedBuffer = Buffer.from(expectedHash, "hex");

	if (expectedBuffer.length !== derivedKey.length) return false;

	return timingSafeEqual(expectedBuffer, derivedKey);
}
