import crypto from "node:crypto";
import { z } from "zod";
import { computeSapHistory } from "./history";
import {
  ESHOP_NUM_AT_CARD_PREFIX,
  sapSyncPayloadSchema,
  type SapOrder,
  type SapPayloadOrder,
  type SapSnapshot,
  type SapSyncPayload,
} from "./types";

// Spracovanie POST /api/sap-sync (docs/SAP-INTEGRATION.md §8). Oddelené od Next
// route handlera, aby sa dalo testovať so štandardným Request/Response bez Next.js.

export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export type SapSyncDeps = {
  secret: string | undefined;
  saveSnapshot: (snapshot: SapSnapshot) => Promise<void>;
  now?: () => Date;
};

// Porovnanie v konštantnom čase. Oba vstupy sa najprv zahashujú, aby mali rovnakú
// dĺžku (timingSafeEqual inak hádže) a dĺžka secretu neunikla cez čas odpovede.
function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = crypto.createHash("sha256").update(provided, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

// Číta telo s limitom — Content-Length nemusí byť prítomný ani pravdivý.
async function readBodyWithLimit(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function isEshopOrder(order: Pick<SapPayloadOrder, "numAtCard">): boolean {
  return order.numAtCard.startsWith(`${ESHOP_NUM_AT_CARD_PREFIX}#`);
}

// "merchyou.shop:#2045" → "#2045" (Shopify order.name).
export function orderNameFromNumAtCard(numAtCard: string): string {
  return numAtCard.slice(ESHOP_NUM_AT_CARD_PREFIX.length);
}

export function buildSapSnapshot(payload: SapSyncPayload, receivedAt: Date): SapSnapshot {
  const byOrderName: Record<string, SapOrder[]> = {};

  for (const { history, ...order } of payload.orders.filter(isEshopOrder)) {
    const { originalLines, textileChange } = computeSapHistory({ ...order, history });
    const orderName = orderNameFromNumAtCard(order.numAtCard);
    (byOrderName[orderName] ??= []).push({ ...order, originalLines, textileChange });
  }

  for (const orders of Object.values(byOrderName)) {
    orders.sort((a, b) => a.docNum - b.docNum);
  }

  return {
    syncedAt: payload.generatedAt,
    receivedAt: receivedAt.toISOString(),
    agent: payload.agent,
    byOrderName,
  };
}

function errorResponse(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}

export async function handleSapSync(request: Request, deps: SapSyncDeps): Promise<Response> {
  if (!secretMatches(request.headers.get("x-sap-sync-secret"), deps.secret)) {
    if (!deps.secret) console.warn("SAP sync: chýba env SAP_SYNC_SECRET, request odmietnutý.");
    return new Response("Unauthorized", { status: 401 });
  }

  const rawBody = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (rawBody === null) {
    return errorResponse(413, `Telo requestu je väčšie než ${MAX_BODY_BYTES} B.`);
  }

  let json: unknown;
  try {
    // Windows PowerShell 5.1 pri UTF-8 rád pridá BOM, JSON.parse by ho odmietol.
    json = JSON.parse(rawBody.replace(/^﻿/, ""));
  } catch {
    return errorResponse(400, "Telo requestu nie je platný JSON.");
  }

  const parsed = sapSyncPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, `Neplatný payload:\n${z.prettifyError(parsed.error)}`);
  }

  const payload = parsed.data;
  const snapshot = buildSapSnapshot(payload, (deps.now ?? (() => new Date()))());
  const orderCount = Object.values(snapshot.byOrderName).reduce((sum, orders) => sum + orders.length, 0);

  // Chyba agenta (prázdny výsledok dotazu, zlý filter) nesmie zmazať celý snapshot.
  // Kontroluje sa po filtri e-shopu — payload len s cudzími ZL by snapshot tiež vyprázdnil.
  if (orderCount === 0 && payload.allowEmpty !== true) {
    const detail = payload.orders.length === 0 ? "Pole orders je prázdne" : "Žiadna ZL nemá numAtCard merchyou.shop:#…";
    return errorResponse(400, `${detail} — snapshot by sa vymazal. Ak je to zámer, pošli "allowEmpty": true.`);
  }

  try {
    await deps.saveSnapshot(snapshot);
  } catch (error) {
    console.error("SAP sync: nepodarilo sa uložiť snapshot do Upstash:", error);
    return errorResponse(500, "Nepodarilo sa uložiť snapshot.");
  }

  const shopifyOrders = Object.keys(snapshot.byOrderName).length;
  console.log(`SAP sync: agent=${payload.agent}, ZL=${orderCount}, objednávky=${shopifyOrders}, syncedAt=${snapshot.syncedAt}`);

  return Response.json({ ok: true, orders: orderCount, shopifyOrders });
}
