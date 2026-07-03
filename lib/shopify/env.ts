export type ShopifyEnv = {
  storeDomain: string;
  clientId: string;
  clientSecret: string;
};

export function getShopifyEnv(): ShopifyEnv {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!storeDomain || !clientId || !clientSecret) {
    throw new Error(
      "Chýbajú Shopify premenné prostredia (SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET)."
    );
  }

  return { storeDomain, clientId, clientSecret };
}
