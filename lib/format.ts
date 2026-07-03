export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("sk-SK", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}
