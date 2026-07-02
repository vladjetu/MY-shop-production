export const SESSION_COOKIE_NAME = "my_shop_session";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getExpectedSessionToken(): Promise<string> {
  const password = process.env.APP_PASSWORD ?? "";
  return sha256Hex(`my-shop-production:${password}`);
}

export function isPasswordCorrect(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD ?? "";
  return expected.length > 0 && candidate === expected;
}
