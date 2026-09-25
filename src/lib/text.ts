// Destination is free-typed by the user (e.g. "abuja, nigeria") and stored
// as-is; this normalizes casing wherever a city/destination is displayed.
export function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
