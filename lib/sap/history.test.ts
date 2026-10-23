import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSapHistory, sapLocalToIso } from "./history";
import type { SapLine } from "./types";

function line(itemCode: string, quantity = 1, lineNum = 0, description = itemCode): SapLine {
  return { lineNum, itemCode, description, quantity };
}

function version(logInstance: number, updatedAt: string, updatedBy: string, lines: SapLine[]) {
  return { logInstance, updatedAt, updatedBy, lines };
}

const L_52017 = line("752002", 1, 0, "STTW259, Natural Raw, L");
const M_52017 = line("752001", 1, 0, "STTW259, Natural Raw, M");

test("ZL 52017 (§4.13): zmena = aktuálna verzia 19. 10. 2026 12:25:19", () => {
  const result = computeSapHistory({
    updatedAt: "2026-10-19T12:25:19",
    updatedBy: "Vladimír Horvát",
    lines: [M_52017],
    history: [
      version(1, "2026-10-18T23:51:40", "B1i", [L_52017]),
      version(2, "2026-10-19T07:46:13", "B1i", [L_52017]),
    ],
  });

  assert.deepEqual(result.originalLines, [L_52017]);
  assert.deepEqual(result.textileChange, {
    changedAt: "2026-10-19T12:25:19+02:00",
    changedBy: "Vladimír Horvát",
    originalLines: [L_52017],
  });
});

test("ZL 52021 (§4.13): zmena = verzia 4 o 12:31:00, nie neskoršia úprava B1i o 13:16:29", () => {
  const L = line("G000822");
  const M = line("G000821");
  const result = computeSapHistory({
    updatedAt: "2026-10-19T13:16:29",
    updatedBy: "B1i",
    lines: [M],
    history: [
      version(1, "2026-10-18T23:51:42", "B1i", [L]),
      version(2, "2026-10-19T07:46:15", "B1i", [L]),
      version(3, "2026-10-19T09:12:47", "B1i", [L]),
      version(4, "2026-10-19T12:31:00", "Vladimír Horvát", [M]),
    ],
  });

  assert.deepEqual(result.originalLines, [L]);
  assert.deepEqual(result.textileChange, {
    changedAt: "2026-10-19T12:31:00+02:00",
    changedBy: "Vladimír Horvát",
    originalLines: [L],
  });
});

test("história nemusí prísť zoradená — rozhoduje logInstance", () => {
  const L = line("G000822");
  const M = line("G000821");
  const result = computeSapHistory({
    updatedAt: "2026-10-19T13:16:29",
    updatedBy: "B1i",
    lines: [M],
    history: [
      version(4, "2026-10-19T12:31:00", "Vladimír Horvát", [M]),
      version(1, "2026-10-18T23:51:42", "B1i", [L]),
    ],
  });

  assert.deepEqual(result.originalLines, [L]);
  assert.equal(result.textileChange?.changedAt, "2026-10-19T12:31:00+02:00");
});

test("ZL bez zmeny textilu: originalLines z verzie 1, textileChange = null", () => {
  const lines = [line("278447", 2, 0), line("278449", 1, 1)];
  const result = computeSapHistory({
    updatedAt: "2026-10-19T07:46:15",
    updatedBy: "B1i",
    lines,
    history: [version(1, "2026-10-18T23:51:42", "B1i", lines)],
  });

  assert.deepEqual(result.originalLines, lines);
  assert.equal(result.textileChange, null);
});

test("poradie riadkov, lineNum ani popis nie sú zmenou (zmazaný a znovu pridaný riadok)", () => {
  const result = computeSapHistory({
    updatedAt: "2026-10-19T10:00:00",
    updatedBy: "Vladimír Horvát",
    lines: [line("278449", 1, 2, "iný popis"), line("278447", 2, 3)],
    history: [version(1, "2026-10-18T23:51:42", "B1i", [line("278447", 2, 0), line("278449", 1, 1)])],
  });

  assert.equal(result.textileChange, null);
});

test("ZL bez histórie: originalLines aj textileChange = null", () => {
  const result = computeSapHistory({
    updatedAt: "2026-10-19T12:25:19",
    updatedBy: "Vladimír Horvát",
    lines: [M_52017],
    history: [],
  });

  assert.deepEqual(result, { originalLines: null, textileChange: null });
});

test("zmena len množstva je zmena textilu", () => {
  const result = computeSapHistory({
    updatedAt: "2026-10-20T08:15:00",
    updatedBy: "Vladimír Horvát",
    lines: [line("752001", 3)],
    history: [version(1, "2026-10-18T23:51:40", "B1i", [line("752001", 2)])],
  });

  assert.deepEqual(result.originalLines, [line("752001", 2)]);
  assert.deepEqual(result.textileChange, {
    changedAt: "2026-10-20T08:15:00+02:00",
    changedBy: "Vladimír Horvát",
    originalLines: [line("752001", 2)],
  });
});

test("návrat na pôvodný textil = bez zmeny", () => {
  const result = computeSapHistory({
    updatedAt: "2026-10-20T08:15:00",
    updatedBy: "Vladimír Horvát",
    lines: [L_52017],
    history: [
      version(1, "2026-10-18T23:51:40", "B1i", [L_52017]),
      version(2, "2026-10-19T12:25:19", "Vladimír Horvát", [M_52017]),
    ],
  });

  assert.equal(result.textileChange, null);
});

test("séria musí byť nepretržitá: M → L → M berie posledný prechod na M", () => {
  const result = computeSapHistory({
    updatedAt: "2026-10-21T09:00:00",
    updatedBy: "B1i",
    lines: [M_52017],
    history: [
      version(1, "2026-10-18T23:51:40", "B1i", [L_52017]),
      version(2, "2026-10-19T12:25:19", "Vladimír Horvát", [M_52017]),
      version(3, "2026-10-19T14:00:00", "Vladimír Horvát", [L_52017]),
      version(4, "2026-10-20T08:00:00", "Support", [M_52017]),
    ],
  });

  assert.equal(result.textileChange?.changedAt, "2026-10-20T08:00:00+02:00");
  assert.equal(result.textileChange?.changedBy, "Support");
});

test("sapLocalToIso: letný čas +02:00, zimný čas +01:00 (Europe/Bratislava)", () => {
  assert.equal(sapLocalToIso("2026-10-19T12:25:19"), "2026-10-19T12:25:19+02:00");
  assert.equal(sapLocalToIso("2026-11-03T07:46:13"), "2026-11-03T07:46:13+01:00");
  // Deň prechodu na zimný čas (25. 10. 2026 o 03:00 → 02:00).
  assert.equal(sapLocalToIso("2026-10-25T12:00:00"), "2026-10-25T12:00:00+01:00");
  assert.equal(sapLocalToIso("2026-03-29T12:00:00"), "2026-03-29T12:00:00+02:00");
});
