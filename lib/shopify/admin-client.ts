import { getShopifyEnv } from "./env";
import { getAccessToken } from "./token";

const API_VERSION = "2024-10";

export async function adminGraphql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const { storeDomain } = getShopifyEnv();
  const url = `https://${storeDomain}/admin/api/${API_VERSION}/graphql.json`;

  const doRequest = (token: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });

  let token = await getAccessToken();
  let response = await doRequest(token);

  if (response.status === 401) {
    // Token mohol medzičasom expirovať skôr, než sme čakali — vynútime nový a skúsime raz znova.
    token = await getAccessToken(true);
    response = await doRequest(token);
  }

  if (!response.ok) {
    throw new Error(`Shopify Admin API zlyhalo (HTTP ${response.status}).`);
  }

  const json = (await response.json()) as { data?: T; errors?: unknown };

  if (json.errors) {
    throw new Error(`Shopify Admin API vrátilo chybu: ${JSON.stringify(json.errors)}`);
  }

  if (!json.data) {
    throw new Error("Shopify Admin API nevrátilo žiadne dáta.");
  }

  return json.data;
}
