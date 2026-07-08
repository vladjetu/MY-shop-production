import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { classifyOrderDeadlineType, computeDeliveryDeadline, writeOrderDeadlineMetafields } from "@/lib/shopify/deadline";
import { fetchStockBySku } from "@/lib/shopify/orders";

// Shopify webhooky nenesú našu session cookie (viď middleware.ts, /api/webhooks je
// v zozname výnimiek) — jediná ochrana je overenie HMAC podpisu, preto sa musí robiť
// nad SUROVÝM telom requestu (nie nad JSON.parse-nutým a znovu serializovaným).
function verifyShopifyHmac(rawBody: string, hmacHeader: string | null): boolean {
  if (!hmacHeader) return false;

  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!secret) return false;

  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  const digestBuffer = Buffer.from(digest);
  const headerBuffer = Buffer.from(hmacHeader);
  if (digestBuffer.length !== headerBuffer.length) return false;

  return crypto.timingSafeEqual(digestBuffer, headerBuffer);
}

type OrderCreatePayload = {
  admin_graphql_api_id?: string;
  created_at?: string;
  name?: string;
  line_items?: { sku?: string | null; quantity?: number }[];
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");

  if (!verifyShopifyHmac(rawBody, hmacHeader)) {
    console.error("Webhook orders/create: neplatný HMAC podpis, request odmietnutý.");
    return new NextResponse("Invalid HMAC signature.", { status: 401 });
  }

  let payload: OrderCreatePayload;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    console.error("Webhook orders/create: telo requestu nie je platný JSON:", error);
    return new NextResponse("Invalid JSON payload.", { status: 400 });
  }

  const orderGid = payload.admin_graphql_api_id;
  const createdAt = payload.created_at;

  if (!orderGid || !createdAt) {
    console.error("Webhook orders/create: chýba admin_graphql_api_id alebo created_at.");
    return new NextResponse("Missing order id or created_at.", { status: 400 });
  }

  try {
    const lineItems = payload.line_items ?? [];
    const skus = lineItems.map((item) => item.sku ?? null);
    const stockBySku = await fetchStockBySku(skus);

    const deadlineLineItems = lineItems.map((item) => ({
      sku: item.sku ?? null,
      quantity: item.quantity ?? 0,
      stockMerchyou: item.sku ? stockBySku.get(item.sku)?.stockMerchyou ?? null : null,
    }));

    const deadlineType = classifyOrderDeadlineType(deadlineLineItems);
    const deliveryDeadline = computeDeliveryDeadline(createdAt, deadlineType);

    await writeOrderDeadlineMetafields(orderGid, deadlineType, deliveryDeadline);

    console.log(
      `Webhook orders/create: objednávka ${payload.name ?? orderGid} -> deadline_type=${deadlineType}, delivery_deadline=${deliveryDeadline}`
    );
  } catch (error) {
    console.error("Webhook orders/create: nepodarilo sa spočítať/zapísať deadline:", error);
    // 500 zámerne — Shopify pri chybe webhook doručenie automaticky opakuje
    // (užitočné pri prechodnej chybe, napr. výpadok Shopify Admin API).
    return new NextResponse("Internal error while computing deadline.", { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
