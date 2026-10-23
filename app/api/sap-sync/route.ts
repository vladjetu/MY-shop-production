import { NextRequest } from "next/server";
import { getSapRedis } from "@/lib/sap/redis";
import { handleSapSync } from "@/lib/sap/sync";
import { SAP_SNAPSHOT_KEY } from "@/lib/sap/types";

// Volá ho SAP agent z AVD (docs/SAP-INTEGRATION.md §8) — nemá našu session cookie
// (viď middleware.ts, /api/sap-sync je v zozname výnimiek). Jediná ochrana je
// x-sap-sync-secret overený v handleSapSync.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleSapSync(request, {
    secret: process.env.SAP_SYNC_SECRET,
    saveSnapshot: async (snapshot) => {
      const redis = getSapRedis();
      if (!redis) throw new Error("Chýbajú Upstash premenné prostredia (KV_REST_API_URL, KV_REST_API_TOKEN).");
      await redis.set(SAP_SNAPSHOT_KEY, snapshot);
    },
  });
}
