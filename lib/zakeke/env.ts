export type ZakekeEnv = {
  clientId: string;
  clientSecret: string;
};

export function getZakekeEnv(): ZakekeEnv {
  const clientId = process.env.ZAKEKE_CLIENT_ID;
  const clientSecret = process.env.ZAKEKE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Chýbajú Zakeke premenné prostredia (ZAKEKE_CLIENT_ID, ZAKEKE_CLIENT_SECRET)."
    );
  }

  return { clientId, clientSecret };
}
