import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatSapAge,
  formatSapChangedAt,
  formatSyncedAt,
  formatZlShortList,
  isSapStale,
  isSapWarningStatus,
  sapCarrier,
  sapCarrierGroups,
  sapStatusLabel,
  sapStatusView,
  sapUserInitials,
} from "./display";
import type { SapOrder } from "./types";

function zl(docNum: number, code: number, pickupPointName: string | null = null, name: string | null = null): SapOrder {
  return {
    docEntry: docNum,
    docNum,
    numAtCard: "merchyou.shop:#9999",
    docType: "5",
    special: null,
    status: "21",
    priority: "S",
    noPrint: false,
    shipping: { code, name, pickupPointId: pickupPointName ? "1" : null, pickupPointName },
    updatedAt: "2026-10-19T07:46:04",
    updatedBy: "B1i",
    lines: [],
    originalLines: null,
    textileChange: null,
  };
}

test("stĺpec ZL: posledné 4 číslice, vzostupne, bez ZL pomlčka", () => {
  assert.equal(formatZlShortList([212604831, 212604829, 212604830]), "4829, 4830, 4831");
  assert.equal(formatZlShortList([]), "—");
});

test("dopravca podľa kódu §10.2, iný kód → názov zo SAP", () => {
  assert.deepEqual(sapCarrier(zl(1, 11).shipping), { key: "packeta", label: "Packeta" });
  assert.deepEqual(sapCarrier(zl(1, 19).shipping), { key: "packeta_courier", label: "Packeta kuriér" });
  assert.deepEqual(sapCarrier(zl(1, 2).shipping), { key: "gls", label: "GLS" });
  assert.deepEqual(sapCarrier(zl(1, 10).shipping), { key: "messenger", label: "Messenger" });
  assert.deepEqual(sapCarrier(zl(1, 1).shipping), { key: "pickup", label: "Osobný odber" });
  assert.deepEqual(sapCarrier(zl(1, 16, null, "DPD").shipping), { key: "other", label: "DPD" });
});

test("#2040: Osobný odber so starou pobočkou v SAP → pobočka sa nepoužije (§4.10)", () => {
  const groups = sapCarrierGroups([zl(212604818, 1, "Z-BOX Bratislava, Račianska 77d")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "Osobný odber");
  assert.equal(groups[0].pickupPointName, null);
});

test("viac dopravcov: každý raz, s vlastnými ZL; pobočka len pri kóde 11", () => {
  const groups = sapCarrierGroups([
    zl(212604820, 2),
    zl(212604818, 11, "Z-BOX Bratislava, Limbová 2A"),
    zl(212604819, 2),
    zl(212604821, 19, "stará pobočka"),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.label, g.docNums, g.pickupPointName]),
    [
      ["Packeta", [212604818], "Z-BOX Bratislava, Limbová 2A"],
      ["GLS", [212604819, 212604820], null],
      ["Packeta kuriér", [212604821], null],
    ],
  );
});

test("stav zákazky: text z číselníka, 63 a 70 ako varovanie", () => {
  assert.equal(sapStatusLabel("21"), "Na ceste");
  assert.equal(sapStatusLabel("99"), "Stav 99");
  assert.equal(isSapWarningStatus("63"), true);
  assert.equal(isSapWarningStatus("70"), true);
  assert.equal(isSapWarningStatus("21"), false);
});

test("ZL bez stavu → bez pillu (label null), nie výnimka", () => {
  assert.equal(sapStatusLabel(null), null);
  assert.equal(isSapWarningStatus(null), false);
  assert.equal(sapStatusView(null, "2026-10-23T10:31:49+02:00", new Date("2026-10-23T10:40:00+02:00")).label, null);
});

test("iniciály používateľa SAP: prvé písmeno každého slova, jednoslovné meno celé", () => {
  assert.equal(sapUserInitials("Vladimír Horvát"), "VH");
  assert.equal(sapUserInitials("René Sebok"), "RS");
  assert.equal(sapUserInitials("ľubica  šťastná"), "ĽŠ");
  assert.equal(sapUserInitials("Ján Pavol Novák"), "JPN");
  assert.equal(sapUserInitials("B1i"), "B1i");
  assert.equal(sapUserInitials("  "), null);
  assert.equal(sapUserInitials(null), null);
});

test("vek dát: do 60 min aktuálne, nad 60 min neaktuálne", () => {
  const syncedAt = "2026-10-23T10:31:49+02:00";
  const at = (iso: string) => new Date(iso);

  assert.deepEqual(formatSapAge(syncedAt, at("2026-10-23T10:44:00+02:00")), { text: "SAP: pred 12 min", stale: false });
  assert.deepEqual(formatSapAge(syncedAt, at("2026-10-23T10:32:00+02:00")), { text: "SAP: pred chvíľou", stale: false });
  assert.equal(isSapStale(syncedAt, at("2026-10-23T11:31:49+02:00")), false);
  assert.equal(isSapStale(syncedAt, at("2026-10-23T11:32:50+02:00")), true);
  assert.deepEqual(formatSapAge(syncedAt, at("2026-10-23T13:40:00+02:00")), {
    text: "SAP dáta neaktuálne (pred 3 h)",
    stale: true,
  });
  assert.equal(isSapStale("nezmysel", at("2026-10-23T10:44:00+02:00")), true);
});

test("časy vždy v Europe/Bratislava (Vercel beží v UTC)", () => {
  assert.equal(formatSyncedAt("2026-10-23T08:31:49Z"), "23. 10. 10:31");
  assert.equal(formatSapChangedAt("2026-10-19T12:25:19+02:00"), "19. 10. 2026 12:25");
  assert.equal(formatSapChangedAt("2026-10-19T12:31:00+02:00"), "19. 10. 2026 12:31");
  // Zimný čas (+01:00) od 25. 10. 2026.
  assert.equal(formatSyncedAt("2026-11-02T07:05:00Z"), "2. 11. 08:05");
});
