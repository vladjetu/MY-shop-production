import { z } from "zod";

// Payload, ktorý posiela SAP agent z AVD na POST /api/sap-sync — kontrakt presne
// podľa docs/SAP-INTEGRATION.md §8. Pri zmene tvaru payloadu zvýš schemaVersion
// a aktualizuj dokument aj agenta.

// SAP UpdateDate + UpdateTS ako lokálny čas SAP servera BEZ časovej zóny
// (YYYY-MM-DDTHH:mm:ss). Server ho interpretuje ako Europe/Bratislava (lib/sap/history.ts).
const sapLocalDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, "očakávaný lokálny čas YYYY-MM-DDTHH:mm:ss bez časovej zóny");

// Len produktové riadky — servisné položky S… agent neposiela.
export const sapLineSchema = z.object({
  lineNum: z.number().int().nonnegative(),
  itemCode: z.string().min(1),
  description: z.string(),
  quantity: z.number().positive(),
});

export const sapHistoryVersionSchema = z.object({
  logInstance: z.number().int().positive(),
  updatedAt: sapLocalDateTime,
  updatedBy: z.string().nullable(),
  lines: z.array(sapLineSchema),
});

export const sapShippingSchema = z.object({
  // OSHP.TrnspCode — UI mapuje dopravcu podľa kódu, nie podľa názvu (§10.2).
  code: z.number().int(),
  name: z.string().nullable(),
  // Platné len pri code = 11; pri iných kódoch môžu v SAP zostať staré údaje (§4.10).
  pickupPointId: z.string().nullable(),
  pickupPointName: z.string().nullable(),
});

export const sapPayloadOrderSchema = z.object({
  docEntry: z.number().int().positive(),
  docNum: z.number().int().positive(),
  numAtCard: z.string(),
  // Surové kódy zo SAP (string) — význam mapuje appka podľa číselníkov §5.3.
  docType: z.string(),
  special: z.string().nullable(),
  status: z.string(),
  priority: z.string().nullable(),
  noPrint: z.boolean(),
  shipping: sapShippingSchema,
  updatedAt: sapLocalDateTime,
  updatedBy: z.string().nullable(),
  lines: z.array(sapLineSchema),
  // Predošlé verzie z Change logu (ADOC/ADO1), zoradené podľa logInstance;
  // prázdne pole, ak log neexistuje. Aktuálna verzia je v poliach vyššie.
  history: z.array(sapHistoryVersionSchema),
});

export const sapSyncPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime({ offset: true }),
  agent: z.string().min(1),
  orders: z.array(sapPayloadOrderSchema),
  // Ochrana pred vymazaním snapshotu chybou agenta (§8).
  allowEmpty: z.boolean().optional(),
});

export type SapLine = z.infer<typeof sapLineSchema>;
export type SapHistoryVersion = z.infer<typeof sapHistoryVersionSchema>;
export type SapShipping = z.infer<typeof sapShippingSchema>;
export type SapPayloadOrder = z.infer<typeof sapPayloadOrderSchema>;
export type SapSyncPayload = z.infer<typeof sapSyncPayloadSchema>;

export type SapTextileChange = {
  // ISO 8601 s offsetom (Europe/Bratislava), napr. "2026-10-19T12:25:19+02:00".
  changedAt: string;
  changedBy: string | null;
  originalLines: SapLine[];
};

// ZL tak, ako sa ukladá do Upstash — bez surovej histórie, len s výsledkom §6.7.
export type SapOrder = Omit<SapPayloadOrder, "history"> & {
  originalLines: SapLine[] | null;
  textileChange: SapTextileChange | null;
};

export type SapSnapshot = {
  // generatedAt z payloadu — kedy agent dáta zo SAP načítal (vek dát v UI, §10.4).
  syncedAt: string;
  // Čas servera pri prijatí syncu.
  receivedAt: string;
  agent: string;
  // Kľúč = Shopify order.name (napr. "#2045"), ZL zoradené podľa docNum.
  byOrderName: Record<string, SapOrder[]>;
};

export const SAP_SNAPSHOT_KEY = "sap:snapshot:v1";
export const ESHOP_NUM_AT_CARD_PREFIX = "merchyou.shop:";
