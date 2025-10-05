export function formatPersonName(firstName?: string, lastName?: string): string {
  return `${firstName ?? ""} ${lastName ?? ""}`.trim();
}
