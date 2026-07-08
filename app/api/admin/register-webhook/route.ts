import { NextResponse } from "next/server";
import { adminGraphql } from "@/lib/shopify/admin-client";

// Jednorazová admin akcia (chránená bežnou session cookie, nie HMAC) — zaregistruje
// alebo aktualizuje Shopify webhook orders/create tak, aby volal našu appku na
// APP_BASE_URL. Bezpečné spustiť opakovane (idempotentné: ak subscription na tento
// topic už existuje, len jej aktualizuje callbackUrl, nevytvorí duplicitu).
export async function POST() {
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) {
    return NextResponse.json(
      { error: "Chýba env variable APP_BASE_URL (napr. https://my-shop-production.vercel.app)." },
      { status: 500 }
    );
  }

  const callbackUrl = `${appBaseUrl.replace(/\/$/, "")}/api/webhooks/orders-create`;

  const existing = await adminGraphql<{
    webhookSubscriptions: { edges: { node: { id: string; callbackUrl: string } }[] };
  }>(
    `
      query ExistingOrdersCreateWebhooks {
        webhookSubscriptions(first: 10, topics: [ORDERS_CREATE]) {
          edges {
            node {
              id
              callbackUrl
            }
          }
        }
      }
    `
  );

  const subscriptions = existing.webhookSubscriptions.edges.map((edge) => edge.node);
  const alreadyCorrect = subscriptions.find((sub) => sub.callbackUrl === callbackUrl);

  if (alreadyCorrect) {
    return NextResponse.json({
      status: "unchanged",
      callbackUrl,
      webhookSubscriptionId: alreadyCorrect.id,
    });
  }

  const staleSubscription = subscriptions[0];

  if (staleSubscription) {
    const data = await adminGraphql<{
      webhookSubscriptionUpdate: {
        webhookSubscription: { id: string; callbackUrl: string } | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    }>(
      `
        mutation UpdateOrdersCreateWebhook($id: ID!, $callbackUrl: URL!) {
          webhookSubscriptionUpdate(
            id: $id
            webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
          ) {
            webhookSubscription {
              id
              callbackUrl
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      { id: staleSubscription.id, callbackUrl }
    );

    if (data.webhookSubscriptionUpdate.userErrors.length > 0) {
      return NextResponse.json(
        { error: JSON.stringify(data.webhookSubscriptionUpdate.userErrors) },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: "updated",
      callbackUrl,
      webhookSubscriptionId: data.webhookSubscriptionUpdate.webhookSubscription?.id,
    });
  }

  const data = await adminGraphql<{
    webhookSubscriptionCreate: {
      webhookSubscription: { id: string; callbackUrl: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    `
      mutation CreateOrdersCreateWebhook($callbackUrl: URL!) {
        webhookSubscriptionCreate(
          topic: ORDERS_CREATE
          webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
        ) {
          webhookSubscription {
            id
            callbackUrl
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { callbackUrl }
  );

  if (data.webhookSubscriptionCreate.userErrors.length > 0) {
    return NextResponse.json(
      { error: JSON.stringify(data.webhookSubscriptionCreate.userErrors) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: "created",
    callbackUrl,
    webhookSubscriptionId: data.webhookSubscriptionCreate.webhookSubscription?.id,
  });
}
