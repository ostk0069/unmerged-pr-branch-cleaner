export function parseBoolean(value: string, name: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be either "true" or "false".`);
}

export function parseRepository(value: string): {
  owner: string;
  repo: string;
} {
  const parts = value.split("/");
  if (parts.length !== 2 || parts.some((part) => part.trim() === "")) {
    throw new Error('repository must use the "owner/name" format.');
  }
  return { owner: parts[0]!, repo: parts[1]! };
}

export function parseInteger(
  value: string,
  name: string,
  minimum: number,
): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(
      `${name} must be an integer greater than or equal to ${minimum}.`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(
      `${name} must be an integer greater than or equal to ${minimum}.`,
    );
  }
  return parsed;
}

export function parsePatterns(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}
