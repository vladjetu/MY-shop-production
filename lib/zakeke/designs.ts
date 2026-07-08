import { zakekeGet } from "./client";
import { fetchMockupPreviewsByOrderId } from "./internal-mockup-previews";

export type ZakekeDesignSide = {
  sideName: string;
  previewUrl: string;
};

export type ZakekeDesign = {
  designId: string;
  productSku: string | null;
  productName: string | null;
  quantity: number;
  printFilesStatus: string | null;
  // Skutočné tlačové súbory (transparentné PNG, presné, použijú sa aj pri downloadoch v kroku 4).
  sides: ZakekeDesignSide[];
  // Mockup na tričku per strana — z neoficiálneho API (viď internal-mockup-previews.ts).
  // Môže byť prázdne, ak sa nepodarilo načítať; UI má vtedy spadnúť späť na `sides`.
  mockups: ZakekeDesignSide[];
};

type OrderItemResponse = {
  productSku: string | null;
  productName: string | null;
  quantity: number;
  design: string | null;
  printFilesStatus: string | null;
  printingFiles: { type: string; url: string; sideName: string }[] | null;
};

type OrderResponse = {
  id: number;
  orderNumber: string;
  items: OrderItemResponse[] | null;
};

// GET /v2/orders vracia priamo pole objednávok (nie objekt s kľúčom "data").
type OrdersListResponse = OrderResponse[];

const PAGE_SIZE = 100;
const MAX_PAGES_TO_SEARCH = 3;

function toProxyUrl(rawUrl: string): string {
  return `/api/zakeke-image?u=${encodeURIComponent(rawUrl)}`;
}

// Design ID (napr. "102539156") nie je samostatné pole v odpovedi API — je zakódované
// v názve print súboru podľa konvencie zdokumentovanej v SPEC.md §3.3:
// {objednávka}_{kódPoložky}_{STRANA}_{printArea}_{x}_000{designID}_{qty}__{farba}.png
function extractDesignIdFromUrl(url: string): string | null {
  const filename = url.split("/").pop() ?? "";
  const segment = filename.split("_")[5];
  if (!segment) return null;
  const stripped = segment.replace(/^0+/, "");
  return stripped.length > 0 ? stripped : null;
}

async function findOrderByNumber(orderNumber: string): Promise<OrderResponse | null> {
  for (let page = 1; page <= MAX_PAGES_TO_SEARCH; page += 1) {
    const orders = await zakekeGet<OrdersListResponse>(
      `/v2/orders?pageSize=${PAGE_SIZE}&pageNumber=${page}`
    );

    const found = orders.find((order) => order.orderNumber === orderNumber);
    if (found) return found;

    if (orders.length < PAGE_SIZE) {
      break;
    }
  }

  return null;
}

// Pre zoznam objednávok (homepage) potrebujeme zistiť len to, ktoré objednávky MAJÚ
// aspoň jednu potlač, aby sme vedeli zobraziť "Bez potlače" namiesto SKU/ks. Aby sme
// nerobili osobitný dopyt na Zakeke pre každú objednávku zvlášť, prejdeme stránky
// /v2/orders raz a hľadáme zhodu len pre čísla, ktoré nás zaujímajú (unfulfilled zo Shopify).
// Stránky sa načítavajú paralelne (nie postupne) — objednávky, ktoré v Zakeke vôbec
// nie sú (napr. bez personalizácie), by inak vynútili sekvenčné prehľadanie všetkých
// stránok a homepage by sa načítavala rádovo desiatky sekúnd.
export async function fetchOrderNumbersWithDesigns(orderNumbers: string[]): Promise<Set<string>> {
  const remaining = new Set(orderNumbers);
  const withDesigns = new Set<string>();

  const pages = await Promise.all(
    Array.from({ length: MAX_PAGES_TO_SEARCH }, (_, index) =>
      zakekeGet<OrdersListResponse>(`/v2/orders?pageSize=${PAGE_SIZE}&pageNumber=${index + 1}`)
    )
  );

  for (const orders of pages) {
    for (const order of orders) {
      if (!remaining.has(order.orderNumber)) continue;

      const hasDesigns = (order.items ?? []).some(
        (item) => (item.printingFiles ?? []).length > 0
      );
      if (hasDesigns) {
        withDesigns.add(order.orderNumber);
      }
      remaining.delete(order.orderNumber);
    }
  }

  return withDesigns;
}

export async function fetchOrderDesigns(orderNumber: string): Promise<ZakekeDesign[]> {
  const order = await findOrderByNumber(orderNumber);
  if (!order) return [];

  const items = order.items ?? [];
  const mockupsByDesignId = await fetchMockupPreviewsByOrderId(order.id);

  return items.map((item) => {
    const files = item.printingFiles ?? [];
    const designId =
      files.map((file) => extractDesignIdFromUrl(file.url)).find(Boolean) ?? item.design ?? "—";

    const mockups = mockupsByDesignId.get(Number(designId)) ?? [];

    return {
      designId,
      productSku: item.productSku,
      productName: item.productName,
      quantity: item.quantity,
      printFilesStatus: item.printFilesStatus,
      sides: files.map((file) => ({
        sideName: file.sideName,
        previewUrl: toProxyUrl(file.url),
      })),
      mockups: mockups.map((mockup) => ({
        sideName: mockup.sideName,
        previewUrl: toProxyUrl(mockup.url),
      })),
    };
  });
}
