export type JsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseJsonObject<T = Record<string, unknown>>(text: string): JsonParseResult<T> {
  try {
    const value = JSON.parse(text) as T;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'JSON value is not an object.' };
    }
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown JSON parse error.',
    };
  }
}

export function parseJsonArray<T = unknown>(text: string): JsonParseResult<T[]> {
  try {
    const value = JSON.parse(text) as T[];
    if (!Array.isArray(value)) {
      return { ok: false, error: 'JSON value is not an array.' };
    }
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown JSON parse error.',
    };
  }
}
