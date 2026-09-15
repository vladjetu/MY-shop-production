import { adminGraphql } from "./admin-client";

// Kľúč jednej položky pre metafield custom.printed_items — SKU (fyzický kus textilu,
// ktorý sa tlačí) + Design ID ako rozlišovač pre prípad, že by sa v objednávke
// opakovalo rovnaké SKU vo viacerých položkách s rôznou grafikou (napr. zákazník si
// dá to isté tričko 2x s inou potlačou). Overené na 500 reálnych objednávkach
// (1183 položiek) zo Zakeke Orders API — dvojica SKU+designId sa v rámci jednej
// objednávky nikdy nezopakovala, na rozdiel od samotného poradia položiek v poli
// (preto sa index zámerne nepoužíva, viď SPEC.md §4.2).
export function printedItemKey(sku: string | null, designId: string): string {
  return `${sku ?? "—"}::${designId}`;
}

export async function setPrintedItemKeys(orderGid: string, keys: string[]): Promise<void> {
  const mutation = `
    mutation SetPrintedItems($metafields: [MetafieldsSetInput!]!) {
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
        key: "printed_items",
        type: "json",
        value: JSON.stringify(keys),
      },
    ],
  });

  if (data.metafieldsSet.userErrors.length > 0) {
    throw new Error(
      `Zápis printed_items metafieldu zlyhal: ${JSON.stringify(data.metafieldsSet.userErrors)}`
    );
  }
}
