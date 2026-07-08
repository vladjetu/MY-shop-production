import { NextResponse } from "next/server";
import { classifyOrderDeadlineType, computeDeliveryDeadline, writeOrderDeadlineMetafields } from "@/lib/shopify/deadline";
import { fetchUnfulfilledOrders } from "@/lib/shopify/orders";

// Jednorazová/opakovateľná admin akcia — chránená našou bežnou session cookie
// (middleware.ts ju nemá vo výnimkách), nie HMAC ako webhook. Dopočíta deadline
// pre unfulfilled objednávky, ktoré ešte nemajú zapísaný metafield (napr. vznikli
// pred nasadením webhooku orders/create).
export async function POST() {
  const orders = await fetchUnfulfilledOrders();
  const missing = orders.filter(
    (order) => order.deadlineType === null || order.deliveryDeadline === null
  );

  const results: {
    orderNumber: string;
    status: "ok" | "error";
    deadlineType?: number;
    deliveryDeadline?: string;
    message?: string;
  }[] = [];

  for (const order of missing) {
    try {
      const deadlineType = classifyOrderDeadlineType(
        order.lineItems.map((item) => ({
          sku: item.sku,
          quantity: item.quantity,
          stockMerchyou: item.stockMerchyou,
        }))
      );
      const deliveryDeadline = computeDeliveryDeadline(order.createdAt, deadlineType);

      await writeOrderDeadlineMetafields(order.id, deadlineType, deliveryDeadline);

      results.push({ orderNumber: order.orderNumber, status: "ok", deadlineType, deliveryDeadline });
    } catch (error) {
      results.push({
        orderNumber: order.orderNumber,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    totalUnfulfilled: orders.length,
    missingBefore: missing.length,
    processed: results.length,
    results,
  });
}
