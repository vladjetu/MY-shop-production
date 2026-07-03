import { adminGraphql } from "./admin-client";

export type ShopifyLineItem = {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  stockMerchyou: string | null;
  stockSuppliers: string | null;
};

export type ShopifyOrder = {
  id: string;
  orderNumber: string;
  createdAt: string;
  customerName: string;
  note: string | null;
  tags: string[];
  pickupPointName?: string;
  lineItems: ShopifyLineItem[];
};

export function hasSapProcessed(tags: string[]): boolean {
  return tags.some((tag) => tag.trim().toLowerCase() === "sap processed");
}

// order.lineItems.length je počet SKU (riadkov), nie počet kusov na potlač —
// jedno SKU môže mať quantity > 1, preto výroba potrebuje vidieť aj súčet kusov.
export function getTotalQuantity(order: ShopifyOrder): number {
  return order.lineItems.reduce((sum, item) => sum + item.quantity, 0);
}

export type Carrier = "Packeta" | "GLS";

function hasTag(tags: string[], name: string): boolean {
  return tags.some((tag) => tag.trim().toLowerCase() === name);
}

export function getCarrier(tags: string[]): Carrier {
  return hasTag(tags, "zasilkovna_selected") ? "Packeta" : "GLS";
}

// Zákazník mal na výber Packetu, ale nevybral konkrétnu pobočku — objednávka ide cez GLS,
// no chceme to vo výrobe odlíšiť od "klasického" GLS bez ponuky Packety.
export function getCarrierLabel(tags: string[], pickupPointName?: string): string {
  const carrier = getCarrier(tags);

  if (carrier === "Packeta") {
    return pickupPointName ? `Packeta · ${pickupPointName}` : "Packeta";
  }

  return hasTag(tags, "zasilkovna_unselected") ? "GLS (nevybraná pobočka Packeta)" : "GLS";
}

// Zakeke pri personalizácii vytvorí Shopify klon produktu (Product type "zakeke-design")
// s rovnakým SKU ako originál. Skladové metafieldy treba čítať z originálneho produktu,
// nie z tohto klonu — preto sa dopytujú samostatne podľa SKU, nie z variantu line itemu.
const ZAKEKE_PRODUCT_TYPE = "zakeke-design";

const ORDER_FIELDS = `
  id
  name
  createdAt
  note
  tags
  shippingAddress {
    firstName
    lastName
  }
  billingAddress {
    firstName
    lastName
  }
  customAttributes {
    key
    value
  }
  lineItems(first: 50) {
    edges {
      node {
        id
        title
        quantity
        sku
        variant {
          sku
          title
        }
      }
    }
  }
`;

type OrderNode = {
  id: string;
  name: string;
  createdAt: string;
  note: string | null;
  tags: string[];
  shippingAddress: { firstName: string | null; lastName: string | null } | null;
  billingAddress: { firstName: string | null; lastName: string | null } | null;
  customAttributes: { key: string; value: string }[];
  lineItems: {
    edges: {
      node: {
        id: string;
        title: string;
        quantity: number;
        sku: string | null;
        variant: {
          sku: string | null;
          title: string | null;
        } | null;
      };
    }[];
  };
};

function nameFromAddress(address: { firstName: string | null; lastName: string | null } | null) {
  if (!address) return null;
  const fullName = [address.firstName, address.lastName].filter(Boolean).join(" ");
  return fullName.length > 0 ? fullName : null;
}

function mapOrder(node: OrderNode): ShopifyOrder {
  const customerName =
    nameFromAddress(node.shippingAddress) ?? nameFromAddress(node.billingAddress) ?? "Neznámy zákazník";

  const pickupPointAttribute = node.customAttributes.find(
    (attr) => attr.key === "PickupPointName"
  );

  const lineItems: ShopifyLineItem[] = node.lineItems.edges.map(({ node: lineItem }) => ({
    id: lineItem.id,
    title: lineItem.title,
    variantTitle: lineItem.variant?.title ?? null,
    sku: lineItem.sku ?? lineItem.variant?.sku ?? null,
    quantity: lineItem.quantity,
    stockMerchyou: null,
    stockSuppliers: null,
  }));

  return {
    id: node.id,
    orderNumber: node.name,
    createdAt: node.createdAt,
    customerName,
    note: node.note,
    tags: node.tags,
    pickupPointName: pickupPointAttribute?.value,
    lineItems,
  };
}

type StockBySku = Map<string, { stockMerchyou: string | null; stockSuppliers: string | null }>;

async function fetchStockBySku(skus: (string | null)[]): Promise<StockBySku> {
  const result: StockBySku = new Map();
  const uniqueSkus = Array.from(new Set(skus.filter((sku): sku is string => Boolean(sku))));

  if (uniqueSkus.length === 0) {
    return result;
  }

  const searchQuery = uniqueSkus.map((sku) => `sku:${JSON.stringify(sku)}`).join(" OR ");

  const query = `
    query VariantsBySku($searchQuery: String!) {
      productVariants(first: 250, query: $searchQuery) {
        edges {
          node {
            sku
            product {
              productType
            }
            metafields(namespace: "custom", first: 10) {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await adminGraphql<{
    productVariants: {
      edges: {
        node: {
          sku: string | null;
          product: { productType: string | null };
          metafields: { edges: { node: { key: string; value: string } }[] };
        };
      }[];
    };
  }>(query, { searchQuery });

  const variants = data.productVariants.edges.map((edge) => edge.node);

  for (const sku of uniqueSkus) {
    const candidates = variants.filter((variant) => variant.sku === sku);
    const original =
      candidates.find(
        (variant) => (variant.product.productType ?? "").trim().toLowerCase() !== ZAKEKE_PRODUCT_TYPE
      ) ?? candidates[0];

    if (!original) continue;

    const metafields = original.metafields.edges;
    const findMetafield = (key: string) =>
      metafields.find((m) => m.node.key === key)?.node.value ?? null;

    result.set(sku, {
      stockMerchyou: findMetafield("stock_merchyou"),
      stockSuppliers: findMetafield("stock_suppliers"),
    });
  }

  return result;
}

async function attachStockData(orders: ShopifyOrder[]): Promise<void> {
  const allSkus = orders.flatMap((order) => order.lineItems.map((item) => item.sku));
  const stockBySku = await fetchStockBySku(allSkus);

  for (const order of orders) {
    for (const item of order.lineItems) {
      if (!item.sku) continue;
      const stock = stockBySku.get(item.sku);
      if (stock) {
        item.stockMerchyou = stock.stockMerchyou;
        item.stockSuppliers = stock.stockSuppliers;
      }
    }
  }
}

export async function fetchUnfulfilledOrders(): Promise<ShopifyOrder[]> {
  const query = `
    query UnfulfilledOrders($first: Int!) {
      orders(
        first: $first
        query: "fulfillment_status:unfulfilled AND status:open"
        sortKey: CREATED_AT
        reverse: false
      ) {
        edges {
          node {
            ${ORDER_FIELDS}
          }
        }
      }
    }
  `;

  const data = await adminGraphql<{ orders: { edges: { node: OrderNode }[] } }>(query, {
    first: 50,
  });

  const orders = data.orders.edges.map((edge) => mapOrder(edge.node));
  await attachStockData(orders);
  return orders;
}

export async function fetchOrderByNumber(orderNumber: string): Promise<ShopifyOrder | null> {
  const normalized = orderNumber.startsWith("#") ? orderNumber : `#${orderNumber}`;

  const query = `
    query OrderByName($searchQuery: String!) {
      orders(first: 1, query: $searchQuery) {
        edges {
          node {
            ${ORDER_FIELDS}
          }
        }
      }
    }
  `;

  const data = await adminGraphql<{ orders: { edges: { node: OrderNode }[] } }>(query, {
    searchQuery: `name:${normalized}`,
  });

  const node = data.orders.edges[0]?.node;
  if (!node) return null;

  const order = mapOrder(node);
  await attachStockData([order]);
  return order;
}
