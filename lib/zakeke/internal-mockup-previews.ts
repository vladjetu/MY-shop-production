import { getOrSetCache } from "../cache";
import { getAccessToken } from "./token";

/**
 * POZOR: Toto je NEZDOKUMENTOVANÉ, interné GraphQL API (apollo.zakeke.com/graphql),
 * objavené reverzným inžinierstvom (Network tab v Zakeke merchant portáli pri
 * zobrazení Order Details) — NIE je súčasťou oficiálnej verejnej Zakeke REST API
 * (docs.zakeke.com).
 *
 * Dôvod použitia: oficiálne REST API (`GET /v3/designs/{designID}/{quantity}`)
 * vracia pole `previewFiles` vždy prázdne pre tento účet — overené opakovane na
 * viacerých objednávkach aj po tom, čo Zakeke support pridal `designModificationID`
 * do Orders API presne podľa ich inštrukcií (pozri SPEC.md §3.2). Toto GraphQL API
 * vracia presne per-stranové mockupy na tričku (`design.previews[]`), ktoré Zakeke
 * sám zobrazuje vo svojom Order Details UI.
 *
 * Autentifikácia funguje s naším vlastným S2S OAuth tokenom (rovnaký token ako
 * pre REST API) — JWT claim `accessType: S2S` a `clientID` sedia s našou appkou,
 * takže nejde o session viazanú na browser login.
 *
 * Riziko: Zakeke môže tento endpoint kedykoľvek zmeniť/obmedziť bez upozornenia,
 * keďže nie je verejne zdokumentovaný — kontaktovali sme ich support, aby sme to
 * časom nahradili oficiálnou cestou (`previewFiles` na REST API), keď/ak to opravia.
 * Preto zlyhanie tohto volania nesmie zhodiť appku — len sa nezobrazí mockup
 * (fallback na reálne tlačové súbory, pozri lib/zakeke/designs.ts).
 */

type MockupPreview = {
  sideName: string;
  url: string;
};

type OrderDetailPreviewsResponse = {
  data?: {
    order: {
      details:
        | {
            designID: number;
            design: { previews: MockupPreview[] | null } | null;
          }[]
        | null;
    } | null;
  };
  errors?: unknown;
};

const PREVIEWS_QUERY = `
  query orderDetailContentQuery($id: ID!) {
    order(id: $id) {
      details {
        designID
        design {
          previews {
            sideName
            url
          }
        }
      }
    }
  }
`;

// Vráti mapu designID (numerické, napr. 102539156) -> mockup obrázky per strana.
// Pri akomkoľvek zlyhaní vráti prázdnu mapu (potichu, viď POZOR vyššie).
export async function fetchMockupPreviewsByOrderId(
  zakekeOrderId: number
): Promise<Map<number, MockupPreview[]>> {
  return getOrSetCache(`zakeke-mockups:${zakekeOrderId}`, () =>
    fetchMockupPreviewsByOrderIdUncached(zakekeOrderId)
  );
}

async function fetchMockupPreviewsByOrderIdUncached(
  zakekeOrderId: number
): Promise<Map<number, MockupPreview[]>> {
  const result = new Map<number, MockupPreview[]>();

  try {
    const token = await getAccessToken();

    const response = await fetch("https://apollo.zakeke.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: PREVIEWS_QUERY,
        variables: { id: `guid://Zakeke/Order/${zakekeOrderId}` },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(`Zakeke interné GraphQL API zlyhalo (HTTP ${response.status}).`);
      return result;
    }

    const json = (await response.json()) as OrderDetailPreviewsResponse;

    if (json.errors) {
      console.error("Zakeke interné GraphQL API vrátilo chybu:", JSON.stringify(json.errors));
      return result;
    }

    const details = json.data?.order?.details ?? [];

    for (const detail of details) {
      if (detail.design?.previews) {
        result.set(detail.designID, detail.design.previews);
      }
    }
  } catch (error) {
    console.error("Nepodarilo sa načítať mockup náhľady zo Zakeke (interné GraphQL API):", error);
  }

  return result;
}
