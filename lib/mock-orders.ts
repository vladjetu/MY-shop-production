export type MockOrder = {
  orderNumber: string;
  createdAt: string;
  customerName: string;
  itemsCount: number;
  tags: string[];
  pickupPointName?: string;
};

// Mock dáta pre krok 1 (kostra appky). V kroku 2 nahradia reálne dáta zo Shopify.
export const mockOrders: MockOrder[] = [
  {
    orderNumber: "#1772",
    createdAt: "2026-06-25T08:14:00.000Z",
    customerName: "Jana Nováková",
    itemsCount: 4,
    tags: ["SAP Processed", "zasilkovna_selected"],
    pickupPointName: "Fresh Market, Košice",
  },
  {
    orderNumber: "#1773",
    createdAt: "2026-06-26T09:41:00.000Z",
    customerName: "Peter Horváth",
    itemsCount: 2,
    tags: ["zasilkovna_unselected"],
    pickupPointName: "Billa, Bratislava - Ružinov",
  },
  {
    orderNumber: "#1774",
    createdAt: "2026-06-27T11:02:00.000Z",
    customerName: "Zuzana Kučerová",
    itemsCount: 6,
    tags: ["SAP Processed"],
  },
  {
    orderNumber: "#1775",
    createdAt: "2026-06-28T13:27:00.000Z",
    customerName: "Martin Baláž",
    itemsCount: 1,
    tags: [],
  },
  {
    orderNumber: "#1776",
    createdAt: "2026-06-29T15:55:00.000Z",
    customerName: "Lucia Šimková",
    itemsCount: 3,
    tags: ["SAP Processed", "zasilkovna_selected"],
    pickupPointName: "Zberné miesto, Žilina",
  },
  {
    orderNumber: "#1777",
    createdAt: "2026-06-30T17:03:00.000Z",
    customerName: "Tomáš Varga",
    itemsCount: 5,
    tags: ["SAP Processed"],
  },
];

export function hasSapProcessed(tags: string[]): boolean {
  return tags.includes("SAP Processed");
}

export function getCarrier(tags: string[]): "Packeta" | "GLS" {
  return tags.some((tag) => tag.startsWith("zasilkovna_")) ? "Packeta" : "GLS";
}

export function getSortedOrders(): MockOrder[] {
  return [...mockOrders].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}
