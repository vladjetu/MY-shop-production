import { ShopifyLineItem } from "./shopify/orders";
import { ZakekeDesign } from "./zakeke/designs";

export type MatchedDesign = {
  design: ZakekeDesign;
  lineItem: ShopifyLineItem | null;
};

// Párovanie je informatívne (SPEC.md §3.2) — podľa SKU + quantity, každý Shopify
// line item sa použije nanajvýš raz, aby sa pri duplicitných SKU (napr. 2× rovnaké
// tričko) dizajny priradili postupne D1, D2, ... a nie všetky na ten istý riadok.
export function matchDesignsToLineItems(
  designs: ZakekeDesign[],
  lineItems: ShopifyLineItem[]
): MatchedDesign[] {
  const usedLineItemIds = new Set<string>();

  return designs.map((design) => {
    const lineItem =
      lineItems.find(
        (item) =>
          !usedLineItemIds.has(item.id) &&
          item.sku &&
          item.sku === design.productSku &&
          item.quantity === design.quantity
      ) ?? null;

    if (lineItem) {
      usedLineItemIds.add(lineItem.id);
    }

    return { design, lineItem };
  });
}
