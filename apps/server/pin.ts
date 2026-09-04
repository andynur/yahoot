/** 6-digit game PIN, no leading zero so it always reads as 6 digits. */
export function generatePin(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}
