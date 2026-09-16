import { adminGraphql } from "./admin-client";

// Shopify metafieldy textového typu (multi_line_text_field) zvyknú odmietať
// prázdny reťazec ako hodnotu ("Value can't be blank"). Namiesto riskovania
// tejto chyby pri vymazaní poznámky preto pri prázdnom texte metafield rovno
// zmažeme — zároveň to udržiava rovnakú sémantiku ako pri ostatných metafieldoch
// v appke (chýbajúci metafield = žiadna hodnota, viď printedItemKeys/deadline).
export async function setProductionNote(orderGid: string, note: string): Promise<void> {
  if (note.length === 0) {
    await deleteProductionNote(orderGid);
    return;
  }

  const mutation = `
    mutation SetProductionNote($metafields: [MetafieldsSetInput!]!) {
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
        key: "production_note",
        type: "multi_line_text_field",
        value: note,
      },
    ],
  });

  if (data.metafieldsSet.userErrors.length > 0) {
    throw new Error(
      `Zápis production_note metafieldu zlyhal: ${JSON.stringify(data.metafieldsSet.userErrors)}`
    );
  }
}

async function deleteProductionNote(orderGid: string): Promise<void> {
  const mutation = `
    mutation DeleteProductionNote($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await adminGraphql<{
    metafieldsDelete: {
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(mutation, {
    metafields: [{ ownerId: orderGid, namespace: "custom", key: "production_note" }],
  });

  if (data.metafieldsDelete.userErrors.length > 0) {
    throw new Error(
      `Zmazanie production_note metafieldu zlyhalo: ${JSON.stringify(data.metafieldsDelete.userErrors)}`
    );
  }
}
