import type { SapLine, SapPayloadOrder, SapTextileChange } from "./types";

// Zmena textilu v SAP podľa docs/SAP-INTEGRATION.md §6.7 (príklady §4.13):
// - pôvodné riadky = verzia 1 z Change logu (zákazka tak, ako ju vytvorila
//   integrácia B1i = pôvodná Shopify objednávka),
// - zmena = riadky aktuálnej verzie sa líšia od verzie 1,
// - čas a autor zmeny = pečiatka NAJSTARŠEJ verzie z poslednej nepretržitej série
//   verzií (log + aktuálna), ktorých riadky sa zhodujú s aktuálnymi. Nie posledná
//   úprava — B1i môže zákazku neskôr upraviť bez zmeny textilu (ZL 52021).

export type SapHistoryResult = {
  originalLines: SapLine[] | null;
  textileChange: SapTextileChange | null;
};

const SAP_TIME_ZONE = "Europe/Bratislava";

// Porovnáva sa celá ZL ako kolekcia dvojíc itemCode + quantity (lineNum ani popis
// nehrajú rolu — funguje aj keď support riadok zmaže a pridá nový). Zoradený
// zoznam namiesto Set, aby dva rovnaké riadky vs. jeden neboli „bez zmeny".
function lineKeys(lines: SapLine[]): string[] {
  return lines.map((line) => `${line.itemCode}\u0000${line.quantity}`).sort();
}

function sameLines(a: SapLine[], b: SapLine[]): boolean {
  const keysA = lineKeys(a);
  const keysB = lineKeys(b);
  return keysA.length === keysB.length && keysA.every((key, i) => key === keysB[i]);
}

// Offset (v minútach) časovej zóny voči UTC v danom okamihu.
function timeZoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

// "2026-10-19T12:25:19" (lokálny čas SAP servera) → "2026-10-19T12:25:19+02:00".
export function sapLocalToIso(localDateTime: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(localDateTime);
  if (!match) throw new Error(`Neplatný SAP čas: ${localDateTime}`);
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s);

  // Offset závisí od letného/zimného času — prvý odhad podľa wall time, potom
  // spresnenie podľa skutočného okamihu (pri prechode času sa môžu líšiť).
  let offset = timeZoneOffsetMinutes(wallAsUtc, SAP_TIME_ZONE);
  offset = timeZoneOffsetMinutes(wallAsUtc - offset * 60000, SAP_TIME_ZONE);

  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${localDateTime}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function computeSapHistory(
  order: Pick<SapPayloadOrder, "updatedAt" | "updatedBy" | "lines" | "history">
): SapHistoryResult {
  if (order.history.length === 0) {
    return { originalLines: null, textileChange: null };
  }

  const history = [...order.history].sort((a, b) => a.logInstance - b.logInstance);
  const originalLines = history[0].lines;

  if (sameLines(originalLines, order.lines)) {
    return { originalLines, textileChange: null };
  }

  const versions = [...history, { updatedAt: order.updatedAt, updatedBy: order.updatedBy, lines: order.lines }];
  let firstCurrent = versions.length - 1;
  while (firstCurrent > 0 && sameLines(versions[firstCurrent - 1].lines, order.lines)) {
    firstCurrent--;
  }

  const changedVersion = versions[firstCurrent];
  return {
    originalLines,
    textileChange: {
      changedAt: sapLocalToIso(changedVersion.updatedAt),
      changedBy: changedVersion.updatedBy,
      originalLines,
    },
  };
}
