import { getShopifyEnv } from "./env";

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

// Cache je len v pamäti bežiacej serverless funkcie (MVP je bezstavové, pozri SPEC.md §2) —
// pri studenom starte sa jednoducho vypýta nový token, čo je pre client credentials grant lacná operácia.
let cachedToken: CachedToken | null = null;

const EXPIRY_SAFETY_MARGIN_MS = 60_000;

async function requestNewToken(): Promise<CachedToken> {
  const { storeDomain, clientId, clientSecret } = getShopifyEnv();

  const response = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Shopify token exchange zlyhal (HTTP ${response.status}).`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS,
  };
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  cachedToken = await requestNewToken();
  return cachedToken.accessToken;
}
