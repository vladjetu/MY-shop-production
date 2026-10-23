import type { SapOrder } from "./types";

// Zobrazenie SAP údajov v UI (docs/SAP-INTEGRATION.md §10). Čisté funkcie bez
// prístupu k Upstash — dáta prichádzajú výhradne zo snapshotu (lib/sap/snapshot.ts).

const SAP_TIME_ZONE = "Europe/Bratislava";

// Dáta staršie ako 60 min sú neaktuálne (§10.3, §10.4) — agent posiela sync
// každých 15 min, takže 60 min znamená niekoľko vynechaných syncov po sebe.
export const SAP_STALE_AFTER_MINUTES = 60;

// ---------- Dopravca (§10.2) ----------

// Rovnaké kľúče pre SAP aj Shopify fallback, aby UI malo jedno mapovanie na štýl badge.
export type CarrierKey = "packeta" | "packeta_courier" | "gls" | "messenger" | "pickup" | "other";

export type CarrierBadge = {
  key: CarrierKey;
  label: string;
};

// Mapovanie podľa KÓDU (OSHP.TrnspCode), nie podľa názvu — názov v SAP sa môže zmeniť.
const SAP_CARRIERS: Record<number, CarrierBadge> = {
  11: { key: "packeta", label: "Packeta" },
  19: { key: "packeta_courier", label: "Packeta kuriér" },
  2: { key: "gls", label: "GLS" },
  10: { key: "messenger", label: "Messenger" },
  1: { key: "pickup", label: "Osobný odber" },
};

export const PACKETA_PICKUP_POINT_CODE = 11;

export function sapCarrier(shipping: SapOrder["shipping"]): CarrierBadge {
  return (
    SAP_CARRIERS[shipping.code] ?? {
      key: "other",
      label: shipping.name?.trim() || `Doprava ${shipping.code}`,
    }
  );
}

export function carrierBadgeClass(key: CarrierKey): string {
  switch (key) {
    case "packeta":
    case "packeta_courier":
      return "badge--carrier-zas";
    case "gls":
      return "badge--carrier-gls";
    case "messenger":
      return "badge--carrier-messenger";
    case "pickup":
      return "badge--carrier-pickup";
    default:
      return "badge--carrier-other";
  }
}

export type SapCarrierGroup = CarrierBadge & {
  // ZL s týmto dopravcom (vzostupne podľa docNum).
  docNums: number[];
  // Pobočka Packety zo SAP — len pri kóde 11 (§4.10: pri iných kódoch môžu v SAP
  // zostať staré údaje o pobočke, napr. #2040 Osobný odber + Z-BOX).
  pickupPointName: string | null;
};

// Každý dopravca raz, v poradí podľa najnižšieho docNum. Dvaja „iní“ dopravcovia
// s rôznym kódom sú rôzne skupiny.
export function sapCarrierGroups(zls: SapOrder[]): SapCarrierGroup[] {
  const groups = new Map<string, SapCarrierGroup>();
  for (const zl of [...zls].sort((a, b) => a.docNum - b.docNum)) {
    const carrier = sapCarrier(zl.shipping);
    const groupKey = carrier.key === "other" ? `other:${zl.shipping.code}` : carrier.key;
    let group = groups.get(groupKey);
    if (!group) {
      group = { ...carrier, docNums: [], pickupPointName: null };
      groups.set(groupKey, group);
    }
    group.docNums.push(zl.docNum);
    const pickupPointName = zl.shipping.pickupPointName?.trim();
    if (zl.shipping.code === PACKETA_PICKUP_POINT_CODE && pickupPointName && !group.pickupPointName) {
      group.pickupPointName = pickupPointName;
    }
  }
  return Array.from(groups.values());
}

// ---------- Čísla ZL (§10.1) ----------

export function shortDocNum(docNum: number): string {
  return String(docNum).slice(-4);
}

// "4829, 4830, 4831" — posledné 4 číslice, vzostupne. Bez ZL → "—".
export function formatZlShortList(docNums: number[]): string {
  if (docNums.length === 0) return "—";
  return [...docNums]
    .sort((a, b) => a - b)
    .map(shortDocNum)
    .join(", ");
}

// ---------- Stav zákazky (§5.3) ----------

const SAP_STATUS_LABELS: Record<string, string> = {
  "10": "Draft",
  "11": "Vytvoriť zálohu",
  "12": "Vystavená záloha",
  "15": "Čaká na odsúhlasenie klientom",
  "20": "Objednať textil",
  "21": "Na ceste",
  "22": "Čiastočne na sklade",
  "23": "Na sklade",
  "30": "Zaplánovaná",
  "40": "Vo výrobe",
  "50": "Odoslané/Odovzdané",
  "60": "Outsourcing",
  "61": "Ukončená výroba",
  "62": "Na expedíciu",
  "63": "Nedostupný textil",
  "70": "Prerušená výroba/Prestoj",
  "71": "Čiastočne na expedíciu",
  "72": "Čiastočne odoslané",
};

// Stavy, ktoré výrobu blokujú — pill s pozadím --color-warning-bg (§10.3).
const SAP_WARNING_STATUSES = new Set(["63", "70"]);

// null = stav v SAP nie je vyplnený → pill sa nezobrazí.
export function sapStatusLabel(status: string | null): string | null {
  if (status === null) return null;
  return SAP_STATUS_LABELS[status] ?? `Stav ${status}`;
}

export function isSapWarningStatus(status: string | null): boolean {
  return status !== null && SAP_WARNING_STATUSES.has(status);
}

// ---------- Používateľ SAP ----------

// "Vladimír Horvát" → "VH": prvé písmeno každého slova, veľkými písmenami.
// Jednoslovné meno (napr. technický user "B1i") sa zobrazí celé. V snapshote
// zostáva celé meno — iniciály sú len zobrazenie.
export function sapUserInitials(name: string | null): string | null {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1) return words[0];
  return words.map((word) => Array.from(word)[0].toLocaleUpperCase("sk-SK")).join("");
}

// Serializovateľný stav ZL pre UI (pill + čas synchronizácie, §10.3) — pripravuje
// sa na serveri, aby sa vek dát nepočítal v prehliadači inak než pri renderi.
export type SapStatusView = {
  // null = stav v SAP chýba, pill sa nezobrazí.
  label: string | null;
  warning: boolean;
  syncedText: string;
  stale: boolean;
};

export function sapStatusView(status: string | null, syncedAt: string, now: Date = new Date()): SapStatusView {
  return {
    label: sapStatusLabel(status),
    warning: isSapWarningStatus(status),
    syncedText: `aktualizované ${formatSyncedAt(syncedAt)}`,
    stale: isSapStale(syncedAt, now),
  };
}

// ---------- Vek dát a časy (§10.4) ----------

export function sapAgeMinutes(syncedAt: string, now: Date = new Date()): number {
  const synced = new Date(syncedAt).getTime();
  if (Number.isNaN(synced)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - synced) / 60000));
}

// Ostro „starší než 60 min“ — presne 60 min je ešte aktuálne.
export function isSapStale(syncedAt: string, now: Date = new Date()): boolean {
  return sapAgeMinutes(syncedAt, now) > SAP_STALE_AFTER_MINUTES;
}

export type SapAge = { text: string; stale: boolean };

// Hlavička zoznamu: "SAP: pred 12 min" / "SAP dáta neaktuálne (pred 3 h)".
export function formatSapAge(syncedAt: string, now: Date = new Date()): SapAge {
  const minutes = sapAgeMinutes(syncedAt, now);
  if (!Number.isFinite(minutes)) return { text: "SAP dáta neaktuálne", stale: true };
  if (minutes > SAP_STALE_AFTER_MINUTES) {
    return { text: `SAP dáta neaktuálne (pred ${Math.floor(minutes / 60)} h)`, stale: true };
  }
  return { text: minutes < 1 ? "SAP: pred chvíľou" : `SAP: pred ${minutes} min`, stale: false };
}

function bratislavaParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SAP_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  // Deň a mesiac bez úvodnej nuly ("2. 11."), aj keď ju niektoré ICU lokály pridajú.
  const unpadded = (type: string) => String(Number(get(type)));
  return { year: get("year"), month: unpadded("month"), day: unpadded("day"), hour: get("hour"), minute: get("minute") };
}

// "23. 10. 14:02" — čas synchronizácie pri stave ZL (vždy Europe/Bratislava, Vercel beží v UTC).
export function formatSyncedAt(iso: string): string {
  const { day, month, hour, minute } = bratislavaParts(iso);
  return `${day}. ${month}. ${hour}:${minute}`;
}

// "19. 10. 2026 12:25" — čas zmeny textilu v SAP.
export function formatSapChangedAt(iso: string): string {
  const { day, month, year, hour, minute } = bratislavaParts(iso);
  return `${day}. ${month}. ${year} ${hour}:${minute}`;
}
