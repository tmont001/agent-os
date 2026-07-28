const PREVIEW_LENGTH = 120;

/**
 * Shared, transport-neutral truncation used by every RunStore's list() so a
 * history list never needs to carry (or, for SqliteRunStore, even read) a
 * full run's input. Correct for any input length: SqliteRunStore pre-bounds
 * what it reads from disk to at most 121 characters (see SqliteRunStore),
 * while InMemoryRunStore may pass the full in-memory string straight through.
 */
export function buildInputPreview(input: string): string {
  if (input.length <= PREVIEW_LENGTH) {
    return input;
  }
  return `${input.slice(0, PREVIEW_LENGTH)}…`;
}
