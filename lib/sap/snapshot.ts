import { getOrSetCache } from "@/lib/cache";
import { getSapRedis } from "./redis";
import { SAP_SNAPSHOT_KEY, type SapOrder, type SapSnapshot } from "./types";

// Čítanie SAP snapshotu zo Upstash (docs/SAP-INTEGRATION.md §9). Appka nikdy nečíta
// priamo SAP. Chýbajúci snapshot, env alebo výpadok Upstash → null + warning; UI sa
// vtedy správa ako pred integráciou (§10.4), nikdy nespadne.

const SAP_SNAPSHOT_TTL_MS = 60 * 1000;

async function fetchSapSnapshot(): Promise<SapSnapshot | null> {
  const redis = getSapRedis();
  if (!redis) {
    console.warn("SAP snapshot: chýbajú Upstash premenné prostredia, SAP dáta sa nezobrazia.");
    return null;
  }

  try {
    const snapshot = await redis.get<SapSnapshot>(SAP_SNAPSHOT_KEY);
    if (!snapshot) {
      console.warn(`SAP snapshot: kľúč ${SAP_SNAPSHOT_KEY} v Upstash neexistuje (agent ešte neposlal sync?).`);
      return null;
    }
    if (typeof snapshot !== "object" || typeof snapshot.byOrderName !== "object" || snapshot.byOrderName === null) {
      console.warn("SAP snapshot: neočakávaný tvar dát v Upstash, ignorujem.");
      return null;
    }
    return snapshot;
  } catch (error) {
    console.warn("SAP snapshot: čítanie z Upstash zlyhalo:", error);
    return null;
  }
}

export function getSapSnapshot(): Promise<SapSnapshot | null> {
  return getOrSetCache("sap:snapshot", fetchSapSnapshot, SAP_SNAPSHOT_TTL_MS);
}

// ZL jednej Shopify objednávky, zoradené podľa docNum. null = snapshot nie je
// k dispozícii (fallback na Shopify), [] = snapshot je, ale objednávka v ňom nemá ZL.
export async function getSapOrdersFor(orderName: string): Promise<SapOrder[] | null> {
  const snapshot = await getSapSnapshot();
  if (!snapshot) return null;
  const key = orderName.startsWith("#") ? orderName : `#${orderName}`;
  return snapshot.byOrderName[key] ?? [];
}
