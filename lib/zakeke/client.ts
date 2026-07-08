import { getAccessToken } from "./token";

const API_BASE = "https://api.zakeke.com";

export class ZakekeNotFoundError extends Error {}

export async function zakekeGet<T>(path: string): Promise<T> {
  const doRequest = (token: string) =>
    fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

  let token = await getAccessToken();
  let response = await doRequest(token);

  if (response.status === 401) {
    token = await getAccessToken(true);
    response = await doRequest(token);
  }

  if (response.status === 404) {
    throw new ZakekeNotFoundError(`Zakeke API: ${path} sa nenašlo (HTTP 404).`);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `Zakeke API zlyhalo (HTTP ${response.status}) pre ${path}. Telo odpovede: ${bodyText}`
    );
  }

  return (await response.json()) as T;
}
