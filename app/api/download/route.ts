import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { matchDesignsToLineItems } from "@/lib/match-designs";
import { fetchOrderByNumber } from "@/lib/shopify/orders";
import { fetchOrderDesigns } from "@/lib/zakeke/designs";

// Orez DTF súborov (sharp.trim() nad plnou paletou) môže pri veľkých obrázkoch
// (4600×5800 px) trvať niekoľko sekúnd. Vercel Hobby plán štandardne dovoľuje
// max. 10 s na serverless funkciu (dá sa zvýšiť len na plánoch vyšších než Hobby) —
// over si v nastaveniach projektu na Verceli, že tento limit appke stačí.
export const maxDuration = 60;

function sanitizeForFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, "-");
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const orderNumber = searchParams.get("order");
  const itemIndexParam = searchParams.get("itemIndex");
  const sideName = searchParams.get("side");
  const format = searchParams.get("format");

  if (!orderNumber || !itemIndexParam || !sideName || (format !== "dtg" && format !== "dtf")) {
    return new NextResponse("Chýbajú alebo sú neplatné parametre requestu.", { status: 400 });
  }

  const itemIndex = Number(itemIndexParam);
  if (!Number.isInteger(itemIndex) || itemIndex < 0) {
    return new NextResponse("Neplatný parameter itemIndex.", { status: 400 });
  }

  let order;
  let designs;

  try {
    [order, designs] = await Promise.all([
      fetchOrderByNumber(orderNumber),
      fetchOrderDesigns(orderNumber),
    ]);
  } catch (error) {
    console.error("Nepodarilo sa pripraviť download (Shopify/Zakeke dáta):", error);
    return new NextResponse(
      "Nepodarilo sa načítať dáta objednávky. Skús to o chvíľu znova.",
      { status: 502 }
    );
  }

  // Identifikujeme položku podľa jej indexu v poli (zodpovedá karte D{index+1} v UI),
  // NIE podľa designId — viacero položiek objednávky môže zdieľať to isté Zakeke
  // designId (napr. rovnaký dizajn aplikovaný na viacero veľkostí), a designId by
  // preto vždy vrátil prvý výskyt bez ohľadu na to, ktorú kartu si operátor klikol.
  const design = designs[itemIndex];
  if (!design) {
    return new NextResponse("Dizajn sa nenašiel.", { status: 404 });
  }

  const side = design.sides.find((s) => s.sideName === sideName);
  if (!side) {
    return new NextResponse("Táto strana dizajnu neexistuje.", { status: 404 });
  }

  const matched = order ? matchDesignsToLineItems(designs, order.lineItems) : [];
  const matchForThis = matched[itemIndex] ?? null;
  const sku = sanitizeForFilename(matchForThis?.lineItem?.sku ?? design.productSku ?? "SKU");
  const quantity = matchForThis?.lineItem?.quantity ?? design.quantity;
  const safeSideName = sanitizeForFilename(sideName);

  const filename = `${orderNumber}-D${itemIndex + 1}-${sku}-${safeSideName}-${quantity}ks-${format.toUpperCase()}.png`;

  let upstream: Response;
  try {
    upstream = await fetch(side.fileUrl, { cache: "no-store" });
  } catch (error) {
    console.error("Nepodarilo sa stiahnuť tlačový súbor zo Zakeke:", error);
    return new NextResponse("Nepodarilo sa stiahnuť tlačový súbor zo Zakeke.", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new NextResponse("Nepodarilo sa stiahnuť tlačový súbor zo Zakeke.", { status: 502 });
  }

  if (format === "dtg") {
    // DTG = originál bez zmeny, streamované priamo prehliadaču bez bufferovania celého súboru.
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // DTF = orez podľa alfa kanála — sharp potrebuje celý súbor v pamäti, nedá sa streamovať.
  const inputBuffer = Buffer.from(await upstream.arrayBuffer());

  let metadata;
  try {
    metadata = await sharp(inputBuffer).metadata();
  } catch (error) {
    console.error("Nepodarilo sa prečítať metadáta PNG:", error);
    return new NextResponse("Súbor sa nepodarilo spracovať (poškodený alebo neplatný PNG).", {
      status: 422,
    });
  }

  if (!metadata.hasAlpha) {
    return new NextResponse(
      "Tento súbor nemá alfa kanál (priehľadné pozadie) — DTF orez nie je možný.",
      { status: 422 }
    );
  }

  // sharp().trim() na celopriehľadnom obrázku obrázok nezmenší (vráti pôvodné rozmery
  // nezmenené) namiesto chyby alebo 0×0 výstupu — preto musíme priehľadnosť overiť
  // vopred cez štatistiku alfa kanála (max hodnota 0 = úplne priehľadné, žiadna grafika).
  const stats = await sharp(inputBuffer).stats();
  const alphaChannel = stats.channels[stats.channels.length - 1];
  if (alphaChannel.max === 0) {
    return new NextResponse(
      "Obrázok je celý priehľadný — pôvodný súbor neobsahuje žiadnu grafiku.",
      { status: 422 }
    );
  }

  let outputBuffer: Buffer;
  try {
    outputBuffer = await sharp(inputBuffer).trim().withMetadata({ density: 300 }).png().toBuffer();
  } catch (error) {
    console.error("Chyba pri orezávaní DTF:", error);
    return new NextResponse("Obrázok sa nepodarilo orezať.", { status: 422 });
  }

  const trimmedMetadata = await sharp(outputBuffer).metadata();
  if (!trimmedMetadata.width || !trimmedMetadata.height) {
    return new NextResponse(
      "Orezaný obrázok je prázdny — pôvodný súbor pravdepodobne neobsahuje žiadnu grafiku.",
      { status: 422 }
    );
  }

  return new NextResponse(new Uint8Array(outputBuffer), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(outputBuffer.length),
    },
  });
}
