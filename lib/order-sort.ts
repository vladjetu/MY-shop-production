export type SortableOrder = {
  orderNumberValue: number;
  createdAt: string;
  deliveryDeadline: string | null;
};

export type SortKey = "orderNumber" | "createdAt" | "deadline";
export type SortDirection = "asc" | "desc";

// Objednávky bez deadlinu (chýbajúci metafield, viď SPEC.md §5) musia pri triedení
// podľa deadlinu skončiť VŽDY na konci — v oboch smeroch, nie náhodne pomiešané
// medzi ostatnými. Preto sa tento prípad rieši mimo bežného obrátenia podľa smeru
// (return priamo, bez prechodu cez sortDirection ? ... : -cmp nižšie).
export function compareOrders<T extends SortableOrder>(
  a: T,
  b: T,
  sortKey: SortKey,
  sortDirection: SortDirection
): number {
  if (sortKey === "deadline") {
    const aMissing = a.deliveryDeadline === null;
    const bMissing = b.deliveryDeadline === null;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    const cmp = a.deliveryDeadline!.localeCompare(b.deliveryDeadline!);
    return sortDirection === "asc" ? cmp : -cmp;
  }

  if (sortKey === "orderNumber") {
    // Číselné porovnanie, nie textové — inak by "#999" skončilo pred "#1772".
    const cmp = a.orderNumberValue - b.orderNumberValue;
    return sortDirection === "asc" ? cmp : -cmp;
  }

  const cmp = a.createdAt.localeCompare(b.createdAt);
  return sortDirection === "asc" ? cmp : -cmp;
}
