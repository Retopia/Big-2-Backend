import crypto from "crypto";

/**
 * Generate a short, deterministic room ID from a name
 */
export function generateRoomId(name) {
  return crypto
    .createHash("sha256")
    .update(name)
    .digest("hex")
    .substring(0, 12);
}

/**
 * Generate a random user ID (UUIDv4-like)
 */
export function generateUserId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

/**
 * Generate a human-readable username if none is provided
 */
export function generateRandomUsername() {
  const adjectives = ["Swift", "Brave", "Clever", "Witty", "Mighty", "Bold"];
  const nouns = ["Lion", "Wolf", "Tiger", "Falcon", "Cheetah", "Eagle"];
  return (
    adjectives[Math.floor(Math.random() * adjectives.length)] +
    nouns[Math.floor(Math.random() * nouns.length)] +
    Math.floor(Math.random() * 1000)
  );
}
