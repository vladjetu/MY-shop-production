import { test } from "node:test";
import assert from "node:assert/strict";
import { sideLabels } from "./side-labels";

function sides(...names: string[]) {
  return names.map((sideName) => ({ sideName }));
}

test("strany s jedinou plochou ostávajú bez čísla", () => {
  assert.deepEqual(sideLabels(sides("FRONT", "BACK", "LEFT SH. SLEEVE")), [
    "FRONT",
    "BACK",
    "LEFT SH. SLEEVE",
  ]);
});

test("viac plôch na tej istej strane dostane poradové čísla (#2017, zástera)", () => {
  assert.deepEqual(sideLabels(sides("FRONT", "FRONT")), ["FRONT 1", "FRONT 2"]);
});

test("číslovanie je nezávislé pre každú stranu", () => {
  assert.deepEqual(sideLabels(sides("FRONT", "BACK", "FRONT", "BACK", "SLEEVE")), [
    "FRONT 1",
    "BACK 1",
    "FRONT 2",
    "BACK 2",
    "SLEEVE",
  ]);
});
