import * as argon2 from 'argon2';

/**
 * argon2id with the OWASP-recommended "second" configuration (19 MiB, 2 iterations, 1 lane):
 * comfortably fast on a Raspberry Pi 5 while still expensive to brute-force.
 */
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
  raw: false,
} as const satisfies argon2.HashOptions & { raw: false };

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

/** Returns false (never throws) for a malformed hash so callers can treat it as a mismatch. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
