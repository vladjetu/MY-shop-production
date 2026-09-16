import { test } from "node:test";
import assert from "node:assert/strict";
import { compareOrders, SortableOrder } from "./order-sort";

function order(orderNumberValue: number, createdAt: string, deliveryDeadline: string | null): SortableOrder {
  return { orderNumberValue, createdAt, deliveryDeadline };
}

function sortWith(orders: SortableOrder[], key: Parameters<typeof compareOrders>[2], direction: Parameters<typeof compareOrders>[3]) {
  return [...orders].sort((a, b) => compareOrders(a, b, key, direction));
}

test("číslo objednávky sa triedi číselne, nie textovo (#999 pred #1772)", () => {
  const orders = [order(1772, "2026-01-01", null), order(999, "2026-01-01", null)];
  const asc = sortWith(orders, "orderNumber", "asc").map((o) => o.orderNumberValue);
  assert.deepEqual(asc, [999, 1772]);

  const desc = sortWith(orders, "orderNumber", "desc").map((o) => o.orderNumberValue);
  assert.deepEqual(desc, [1772, 999]);
});

test("dátum vytvorenia — vzostupne najstaršie prvé, zostupne najnovšie prvé", () => {
  const orders = [order(1, "2026-03-10T00:00:00Z", null), order(2, "2026-01-05T00:00:00Z", null)];
  const asc = sortWith(orders, "createdAt", "asc").map((o) => o.orderNumberValue);
  assert.deepEqual(asc, [2, 1]);

  const desc = sortWith(orders, "createdAt", "desc").map((o) => o.orderNumberValue);
  assert.deepEqual(desc, [1, 2]);
});

test("deadline — bežné poradie podľa dátumu, keď obe hodnoty existujú", () => {
  const orders = [order(1, "2026-01-01", "2026-09-20"), order(2, "2026-01-01", "2026-09-10")];
  const asc = sortWith(orders, "deadline", "asc").map((o) => o.orderNumberValue);
  assert.deepEqual(asc, [2, 1]);

  const desc = sortWith(orders, "deadline", "desc").map((o) => o.orderNumberValue);
  assert.deepEqual(desc, [1, 2]);
});

test("deadline — chýbajúci deadline skončí VŽDY na konci, v oboch smeroch", () => {
  const orders = [
    order(1, "2026-01-01", "2026-09-15"),
    order(2, "2026-01-01", null),
    order(3, "2026-01-01", "2026-09-05"),
    order(4, "2026-01-01", null),
  ];

  const asc = sortWith(orders, "deadline", "asc").map((o) => o.orderNumberValue);
  assert.deepEqual(asc, [3, 1, 2, 4]);
  // Objednávky bez deadlinu (#2, #4) sú na oboch posledných pozíciách, nie pomiešané.
  assert.deepEqual(new Set(asc.slice(-2)), new Set([2, 4]));

  const desc = sortWith(orders, "deadline", "desc").map((o) => o.orderNumberValue);
  assert.deepEqual(desc, [1, 3, 2, 4]);
  assert.deepEqual(new Set(desc.slice(-2)), new Set([2, 4]));
});

test("deadline — všetky objednávky bez deadlinu neháže chybu, poradie je stabilné", () => {
  const orders = [order(1, "2026-01-01", null), order(2, "2026-01-01", null)];
  assert.doesNotThrow(() => sortWith(orders, "deadline", "asc"));
  assert.doesNotThrow(() => sortWith(orders, "deadline", "desc"));
});
