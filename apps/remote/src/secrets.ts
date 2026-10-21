import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Separate AAD binds ciphertext to its user and purpose, so rows cannot be swapped across accounts. */
export function privateValues(hexKey: string) {
  const key = Buffer.from(hexKey, "hex");
  if (!/^[a-f0-9]{64}$/i.test(hexKey)) throw Error("Invalid encryption key.");
  return {
    seal(value: string, scope: string): string {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(scope));
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return [iv, cipher.getAuthTag(), encrypted]
        .map((part) => part.toString("base64url"))
        .join(".");
    },
    open(value: string, scope: string): string {
      const [iv, tag, data] = value
        .split(".")
        .map((part) => Buffer.from(part, "base64url"));
      if (!iv || !tag || !data) throw Error("Invalid private record.");
      const cipher = createDecipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(scope));
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(data), cipher.final()]).toString(
        "utf8",
      );
    },
  };
}
