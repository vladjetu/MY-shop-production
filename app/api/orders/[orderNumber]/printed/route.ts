import { NextRequest, NextResponse } from "next/server";
import { fetchOrderByNumber } from "@/lib/shopify/orders";
import { setPrintedItemKeys } from "@/lib/shopify/printed-items";

// Chránené rovnakou session cookie ako zvyšok appky — middleware.ts nemá túto cestu
// vo výnimkách z auth presmerovania.
//
// Read-modify-write bez zámku: prečíta aktuálny zoznam priamo zo Shopify (Shopify
// dáta appka necachuje, viď fetchOrderByNumber), pridá/odoberie kľúč a zapíše späť.
// Ak by dvaja ľudia naraz (v tej istej sekunde) prepli DVE RÔZNE položky TEJ ISTEJ
// objednávky, jeden zápis môže prepísať druhý — pre appku bez vlastného úložiska
// (§2 SPEC.md) je toto akceptované riziko, nie chyba (viď SPEC.md §2 a §6).
export async function POST(
  request: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  let body: { key?: unknown; printed?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatná požiadavka." }, { status: 400 });
  }

  const key = body.key;
  const printed = body.printed;
  if (typeof key !== "string" || key.length === 0 || typeof printed !== "boolean") {
    return NextResponse.json({ error: "Neplatná požiadavka." }, { status: 400 });
  }

  try {
    const order = await fetchOrderByNumber(params.orderNumber);
    if (!order) {
      return NextResponse.json({ error: "Objednávka sa nenašla." }, { status: 404 });
    }

    const updatedKeys = new Set(order.printedItemKeys);
    if (printed) {
      updatedKeys.add(key);
    } else {
      updatedKeys.delete(key);
    }

    const printedItemKeys = Array.from(updatedKeys);
    await setPrintedItemKeys(order.id, printedItemKeys);

    return NextResponse.json({ printedItemKeys });
  } catch (error) {
    console.error("Nepodarilo sa zapísať stav vytlačenia položky:", error);
    return NextResponse.json(
      { error: "Nepodarilo sa uložiť stav. Skús to znova." },
      { status: 500 }
    );
  }
}
