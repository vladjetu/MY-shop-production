import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleSapSync, MAX_BODY_BYTES } from "./sync";
import { sapSyncPayloadSchema, type SapSnapshot } from "./types";

const SECRET = "test-secret-123";
const SAMPLE_PATH = join(process.cwd(), "tools", "sap-agent", "sample-payload.json");

function samplePayload() {
  return JSON.parse(readFileSync(SAMPLE_PATH, "utf8"));
}

function syncRequest(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-sap-sync-secret"] = secret;
  return new Request("http://localhost/api/sap-sync", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function runSync(body: unknown, options: { secret?: string | null; envSecret?: string } = {}) {
  const saved: SapSnapshot[] = [];
  const response = await handleSapSync(syncRequest(body, options.secret === undefined ? SECRET : options.secret), {
    secret: "envSecret" in options ? options.envSecret : SECRET,
    saveSnapshot: async (snapshot) => {
      saved.push(snapshot);
    },
    now: () => new Date("2026-10-22T12:06:00.000Z"),
  });
  return { response, saved };
}

test("vzorový payload prejde schémou", () => {
  const result = sapSyncPayloadSchema.safeParse(samplePayload());
  assert.ok(result.success, result.success ? "" : result.error.message);
});

test("schéma odmietne updatedAt s časovou zónou, číselný status a textový kód dopravy", () => {
  for (const mutate of [
    (o: any) => (o.updatedAt = "2026-10-19T12:25:19+02:00"),
    (o: any) => (o.status = 21),
    (o: any) => (o.shipping.code = "11"),
    (o: any) => delete o.lines[0].lineNum,
    (o: any) => delete o.history,
  ]) {
    const payload = samplePayload();
    mutate(payload.orders[0]);
    assert.equal(sapSyncPayloadSchema.safeParse(payload).success, false);
  }
});

test("zlý secret → 401 bez detailov, nič sa neuloží", async () => {
  const { response, saved } = await runSync(samplePayload(), { secret: "zly-secret" });
  assert.equal(response.status, 401);
  assert.equal(await response.text(), "Unauthorized");
  assert.equal(saved.length, 0);
});

test("chýbajúca hlavička → 401", async () => {
  const { response, saved } = await runSync(samplePayload(), { secret: null });
  assert.equal(response.status, 401);
  assert.equal(saved.length, 0);
});

test("chýbajúci SAP_SYNC_SECRET na serveri → 401 aj pri akomkoľvek secrete", async () => {
  const { response, saved } = await runSync(samplePayload(), { secret: "", envSecret: undefined });
  assert.equal(response.status, 401);
  assert.equal(saved.length, 0);
});

test("neplatný payload → 400 s popisom chyby", async () => {
  const payload = samplePayload();
  payload.orders[0].docNum = "212604829";
  const { response, saved } = await runSync(payload);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /docNum/);
  assert.equal(saved.length, 0);
});

test("neplatný JSON → 400", async () => {
  const { response } = await runSync("{ nie je json");
  assert.equal(response.status, 400);
});

test("telo nad 2 MB → 413", async () => {
  const { response, saved } = await runSync("x".repeat(MAX_BODY_BYTES + 1));
  assert.equal(response.status, 413);
  assert.equal(saved.length, 0);
});

test("prázdne orders → 400, s allowEmpty: true sa uloží prázdny snapshot", async () => {
  const payload = { ...samplePayload(), orders: [] };

  const rejected = await runSync(payload);
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.saved.length, 0);

  const allowed = await runSync({ ...payload, allowEmpty: true });
  assert.equal(allowed.response.status, 200);
  assert.deepEqual(await allowed.response.json(), { ok: true, orders: 0, shopifyOrders: 0 });
  assert.deepEqual(allowed.saved[0].byOrderName, {});
});

test("filter e-shopu: ZL bez prefixu merchyou.shop:# sa ignorujú", async () => {
  const payload = samplePayload();
  payload.orders[0].numAtCard = "merchshop.com:#2045";
  payload.orders[1].numAtCard = "merchyou.shop:2045";
  payload.orders[2].numAtCard = "PO-12345";

  const { response, saved } = await runSync(payload);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, orders: 5, shopifyOrders: 2 });
  assert.deepEqual(
    saved[0].byOrderName["#2045"].map((o) => o.docEntry),
    [52020, 52021]
  );
});

test("len cudzie ZL → 400 (snapshot by sa vyprázdnil)", async () => {
  const payload = samplePayload();
  for (const order of payload.orders) order.numAtCard = "merchshop.com:#1";
  const { response, saved } = await runSync(payload);
  assert.equal(response.status, 400);
  assert.equal(saved.length, 0);
});

test("zoskupenie podľa order name, zoradenie podľa docNum, výsledok histórie bez poľa history", async () => {
  const payload = samplePayload();
  payload.orders.reverse();

  const { response, saved } = await runSync(payload);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, orders: 8, shopifyOrders: 2 });

  const snapshot = saved[0];
  assert.equal(snapshot.syncedAt, "2026-10-22T14:05:00+02:00");
  assert.equal(snapshot.receivedAt, "2026-10-22T12:06:00.000Z");
  assert.equal(snapshot.agent, "avd-ps-1.0");
  assert.deepEqual(Object.keys(snapshot.byOrderName).sort(), ["#2040", "#2045"]);
  assert.deepEqual(
    snapshot.byOrderName["#2045"].map((o) => o.docNum),
    [212604829, 212604830, 212604831, 212604832, 212604833]
  );
  assert.deepEqual(
    snapshot.byOrderName["#2040"].map((o) => o.docNum),
    [212604790, 212604791, 212604792]
  );

  for (const order of Object.values(snapshot.byOrderName).flat()) {
    assert.equal("history" in order, false);
    assert.notEqual(order.originalLines, null);
  }

  const changed = Object.fromEntries(
    Object.values(snapshot.byOrderName)
      .flat()
      .filter((o) => o.textileChange)
      .map((o) => [o.docEntry, o.textileChange?.changedAt])
  );
  assert.deepEqual(changed, {
    52017: "2026-10-19T12:25:19+02:00",
    52021: "2026-10-19T12:31:00+02:00",
  });
});

test("chyba pri ukladaní → 500", async () => {
  const response = await handleSapSync(syncRequest(samplePayload()), {
    secret: SECRET,
    saveSnapshot: async () => {
      throw new Error("Upstash nedostupný");
    },
  });
  assert.equal(response.status, 500);
});
