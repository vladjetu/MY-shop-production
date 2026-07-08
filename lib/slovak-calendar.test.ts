import { test } from "node:test";
import assert from "node:assert/strict";
import { addBusinessDays, isBusinessDay, isSlovakPublicHoliday } from "./slovak-calendar";

function utc(year: number, month: number, day: number): Date {
  // month je 1-based (na rozdiel od natívneho Date), aby sa testy ľahšie čítali.
  return new Date(Date.UTC(year, month - 1, day));
}

test("fixed holidays sú rozpoznané", () => {
  assert.equal(isSlovakPublicHoliday(utc(2026, 1, 1)), true); // Nový rok
  assert.equal(isSlovakPublicHoliday(utc(2026, 1, 6)), true); // Traja králi
  assert.equal(isSlovakPublicHoliday(utc(2026, 5, 1)), true);
  assert.equal(isSlovakPublicHoliday(utc(2026, 5, 8)), true);
  assert.equal(isSlovakPublicHoliday(utc(2026, 7, 5)), true);
  assert.equal(isSlovakPublicHoliday(utc(2026, 8, 29)), true);
  assert.equal(isSlovakPublicHoliday(utc(2026, 9, 1)), true);
  assert.equal(isSlovakPublicHoliday(utc(2026, 9, 15)), true);
  assert.equal(isSlovakPublicHoliday(utc(2026, 11, 1)), true);
  assert.equal(isSlovakPublicHoliday(utc(2026, 11, 17)), true);
  assert.equal(isSlovakPublicHoliday(utc(2026, 12, 24)), true);
  assert.equal(isSlovakPublicHoliday(utc(2026, 12, 25)), true);
  assert.equal(isSlovakPublicHoliday(utc(2026, 12, 26)), true);
});

test("bežný pracovný deň nie je sviatok", () => {
  assert.equal(isSlovakPublicHoliday(utc(2026, 6, 30)), false);
});

test("Veľký piatok a Veľkonočný pondelok — algoritmicky (2024/2025/2026)", () => {
  // Veľká noc: 2024-03-31, 2025-04-20, 2026-04-05 (overené známe dátumy).
  assert.equal(isSlovakPublicHoliday(utc(2024, 3, 29)), true); // Veľký piatok 2024
  assert.equal(isSlovakPublicHoliday(utc(2024, 4, 1)), true); // Veľkonočný pondelok 2024

  assert.equal(isSlovakPublicHoliday(utc(2025, 4, 18)), true); // Veľký piatok 2025
  assert.equal(isSlovakPublicHoliday(utc(2025, 4, 21)), true); // Veľkonočný pondelok 2025

  assert.equal(isSlovakPublicHoliday(utc(2026, 4, 3)), true); // Veľký piatok 2026
  assert.equal(isSlovakPublicHoliday(utc(2026, 4, 6)), true); // Veľkonočný pondelok 2026

  // Samotná Veľkonočná nedeľa nie je vo FIXED_HOLIDAYS, ale je to nedeľa —
  // isBusinessDay ju aj tak vylúči cez pravidlo víkendu.
  assert.equal(isBusinessDay(utc(2026, 4, 5)), false);
});

test("isBusinessDay: víkend aj sviatok vracia false, bežný deň true", () => {
  assert.equal(isBusinessDay(utc(2026, 7, 4)), false); // sobota
  assert.equal(isBusinessDay(utc(2026, 7, 5)), false); // nedeľa
  assert.equal(isBusinessDay(utc(2026, 1, 1)), false); // sviatok (aj keby padol na všedný deň)
  assert.equal(isBusinessDay(utc(2026, 6, 30)), true); // bežný utorok
});

test("addBusinessDays: bez sviatkov v okne", () => {
  // Pondelok 2026-06-29 + 3 pracovné dni = štvrtok 2026-07-02 (žiadny sviatok medzi tým).
  const result = addBusinessDays(utc(2026, 6, 29), 3);
  assert.equal(result.getUTCFullYear(), 2026);
  assert.equal(result.getUTCMonth() + 1, 7);
  assert.equal(result.getUTCDate(), 2);
});

test("addBusinessDays: preskočí Veľký piatok, víkend aj Veľkonočný pondelok", () => {
  // Streda 2026-04-01 + 3 pracovné dni:
  // št 4/2 (1), pi 4/3 sviatok, so 4/4, ne 4/5, po 4/6 sviatok, ut 4/7 (2), st 4/8 (3).
  const result = addBusinessDays(utc(2026, 4, 1), 3);
  assert.equal(result.getUTCFullYear(), 2026);
  assert.equal(result.getUTCMonth() + 1, 4);
  assert.equal(result.getUTCDate(), 8);
});

test("addBusinessDays: 12 pracovných dní od objednávky", () => {
  // Pondelok 2026-06-29 + 12 pracovných dní, bez sviatkov v okne (júl bez SR sviatku
  // do 5.7.) — over si aj prechod cez 5.7. (Cyril a Metod).
  // po 6/29 -> ut30(1) st7/1(2) št2(3) pi3(4) so4 ne5 po6(5) ut7(6) st8(7) št9(8) pi10(9)
  // so11 ne12 po13(10) ut14(11) st15(12)
  const result = addBusinessDays(utc(2026, 6, 29), 12);
  assert.equal(result.getUTCFullYear(), 2026);
  assert.equal(result.getUTCMonth() + 1, 7);
  assert.equal(result.getUTCDate(), 15);
});
