import { addBusinessDays } from "../slovak-calendar";
import { adminGraphql } from "./admin-client";

export type DeadlineType = 3 | 12;

export type DeadlineLineItemInput = {
  sku: string | null;
  quantity: number;
  stockMerchyou: string | null;
};

// Ak nevieme SKU alebo sklad overiť (chýbajúci metafield na produkte), radšej
// konzervatívne 12 pracovných dní, než aby appka omylom sľúbila kratší termín.
export function classifyOrderDeadlineType(lineItems: DeadlineLineItemInput[]): DeadlineType {
  for (const item of lineItems) {
    const stock = item.stockMerchyou !== null ? Number(item.stockMerchyou) : null;
    if (stock === null || Number.isNaN(stock) || stock < item.quantity) {
      return 12;
    }
  }

  return 3;
}

function formatISODate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function computeDeliveryDeadline(createdAt: string, deadlineType: DeadlineType): string {
  const createdDate = new Date(createdAt);
  const deadlineDate = addBusinessDays(createdDate, deadlineType);
  return formatISODate(deadlineDate);
}

export async function writeOrderDeadlineMetafields(
  orderGid: string,
  deadlineType: DeadlineType,
  deliveryDeadline: string
): Promise<void> {
  const mutation = `
    mutation SetOrderDeadline($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await adminGraphql<{
    metafieldsSet: {
      metafields: { id: string }[];
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(mutation, {
    metafields: [
      {
        ownerId: orderGid,
        namespace: "custom",
        key: "deadline_type",
        type: "number_integer",
        value: String(deadlineType),
      },
      {
        ownerId: orderGid,
        namespace: "custom",
        key: "delivery_deadline",
        type: "date",
        value: deliveryDeadline,
      },
    ],
  });

  if (data.metafieldsSet.userErrors.length > 0) {
    throw new Error(
      `Zápis deadline metafieldov zlyhal: ${JSON.stringify(data.metafieldsSet.userErrors)}`
    );
  }
}
