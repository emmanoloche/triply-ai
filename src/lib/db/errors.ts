// Postgres unique_violation is SQLSTATE 23505. Drivers/ORMs may wrap the
// original error in `cause`, so check both levels.
export function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);
  return code(error) === "23505" || code((error as { cause?: unknown } | null)?.cause) === "23505";
}
