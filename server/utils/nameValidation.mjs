export const PLAYER_NAME_MAX_LENGTH = 24;
export const ROOM_NAME_MAX_LENGTH = 32;

const NAME_PATTERN = /^[\p{L}\p{N} _.-]+$/u;

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripControlCharacters(value) {
  let result = "";
  for (const char of value) {
    const codePoint = char.charCodeAt(0);
    if (codePoint >= 32 && codePoint !== 127) {
      result += char;
    }
  }
  return result;
}

export function normalizeNameInput(value) {
  if (typeof value !== "string") return "";

  return stripControlCharacters(safeDecodeURIComponent(value))
    .replace(/\s+/g, " ")
    .trim();
}

function validateName(rawValue, label, maxLength) {
  const value = normalizeNameInput(rawValue);
  if (!value) {
    return { ok: false, error: `${label} cannot be empty.` };
  }

  if (value.length > maxLength) {
    return {
      ok: false,
      error: `${label} must be ${maxLength} characters or fewer.`,
    };
  }

  if (!NAME_PATTERN.test(value)) {
    return {
      ok: false,
      error:
        `${label} may only include letters, numbers, spaces, hyphens, underscores, and periods.`,
    };
  }

  return { ok: true, value };
}

export function validatePlayerName(rawValue) {
  return validateName(rawValue, "Username", PLAYER_NAME_MAX_LENGTH);
}

export function validateRoomName(rawValue) {
  return validateName(rawValue, "Room name", ROOM_NAME_MAX_LENGTH);
}

export function ensureUniqueName(baseName, isTaken, maxLength) {
  const trimmedBase = baseName.slice(0, maxLength);
  let candidate = trimmedBase;
  let suffix = 2;

  while (isTaken(candidate)) {
    const suffixText = String(suffix);
    const prefixLimit = Math.max(1, maxLength - suffixText.length);
    candidate = `${trimmedBase.slice(0, prefixLimit)}${suffixText}`;
    suffix += 1;
  }

  return candidate;
}
