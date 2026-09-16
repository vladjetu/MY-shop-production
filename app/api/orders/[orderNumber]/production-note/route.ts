import { NextRequest, NextResponse } from "next/server";
import { fetchOrderByNumber } from "@/lib/shopify/orders";
import { setProductionNote } from "@/lib/shopify/production-note";

// Chránené rovnakou session cookie ako zvyšok appky (middleware.ts).
//
// Appka nemá užívateľské účty, takže dvaja ľudia môžu editovať tú istú poznámku
// naraz. Namiesto tichého prepísania (posledný zápis vyhráva) klient posiela
// `expectedBaseline` — hodnotu, z ktorej vychádzal pri písaní. Ak sa odvtedy
// aktuálna hodnota na serveri líši, ide o konflikt (niekto iný medzičasom
// zapísal inú verziu) a zápis odmietneme (409) namiesto prepísania. `force: true`
// (po tom, čo si to používateľ v UI vedome zvolí) kontrolu obíde.
//
// Zostáva tu úzke okno medzi kontrolou a zápisom (nejde o atomický
// compare-and-swap — Shopify metafieldsSet ho neponúka), ale výrazne to
// znižuje riziko tichej straty poznámky oproti čistému "posledný zápis vyhráva".
export async function POST(
  request: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  let body: { note?: unknown; expectedBaseline?: unknown; force?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatná požiadavka." }, { status: 400 });
  }

  const note = body.note;
  const expectedBaseline = body.expectedBaseline;
  const force = body.force === true;
  if (
    typeof note !== "string" ||
    (expectedBaseline !== undefined && typeof expectedBaseline !== "string")
  ) {
    return NextResponse.json({ error: "Neplatná požiadavka." }, { status: 400 });
  }

  try {
    const order = await fetchOrderByNumber(params.orderNumber);
    if (!order) {
      return NextResponse.json({ error: "Objednávka sa nenašla." }, { status: 404 });
    }

    if (!force && typeof expectedBaseline === "string" && order.productionNote !== expectedBaseline) {
      return NextResponse.json(
        {
          error: "conflict",
          message: "Poznámka bola medzitým zmenená inde.",
          currentNote: order.productionNote,
        },
        { status: 409 }
      );
    }

    await setProductionNote(order.id, note);

    return NextResponse.json({ note });
  } catch (error) {
    console.error("Nepodarilo sa zapísať poznámku výroby:", error);
    return NextResponse.json(
      { error: "Nepodarilo sa uložiť poznámku. Skús to znova." },
      { status: 500 }
    );
  }
}
