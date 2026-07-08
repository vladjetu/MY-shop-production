import { getZakekeEnv } from "./env";

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

// Rovnaký princíp ako u Shopify tokenu (lib/shopify/token.ts) — cache len v pamäti
// bežiacej serverless funkcie, obnova pred expiráciou.
let cachedToken: CachedToken | null = null;

const EXPIRY_SAFETY_MARGIN_MS = 60_000;

async function requestNewToken(): Promise<CachedToken> {
  const { clientId, clientSecret } = getZakekeEnv();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch("https://api.zakeke.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      access_type: "S2S",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Zakeke token exchange zlyhal (HTTP ${response.status}).`);
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
