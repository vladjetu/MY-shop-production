"use client";

import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { compareOrders, SortDirection, SortKey } from "@/lib/order-sort";

export type OrderRow = {
  orderNumber: string;
  orderNumberValue: number;
  href: string;
  createdAt: string;
  customerName: string;
  skuLabel: string;
  carrier: "Packeta" | "GLS";
  carrierLabel: string;
  sapDone: boolean;
  deliveryDeadline: string | null;
  overdue: boolean;
};

const DEFAULT_SORT_KEY: SortKey = "createdAt";
const DEFAULT_SORT_DIRECTION: SortDirection = "asc";

export function OrdersList({ orders }: { orders: OrderRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT_KEY);
  const [sortDirection, setSortDirection] = useState<SortDirection>(DEFAULT_SORT_DIRECTION);
  const [searchQuery, setSearchQuery] = useState("");

  const isDefaultState =
    sortKey === DEFAULT_SORT_KEY && sortDirection === DEFAULT_SORT_DIRECTION && searchQuery.trim() === "";

  const visibleOrders = useMemo(() => {
    const query = searchQuery.trim().replace(/^#/, "");
    const filtered = query
      ? orders.filter((order) => order.orderNumberValue.toString().includes(query))
      : orders;

    return [...filtered].sort((a, b) => compareOrders(a, b, sortKey, sortDirection));
  }, [orders, searchQuery, sortKey, sortDirection]);

  function handleSortClick(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  function handleReset() {
    setSortKey(DEFAULT_SORT_KEY);
    setSortDirection(DEFAULT_SORT_DIRECTION);
    setSearchQuery("");
  }

  function ariaSortFor(key: SortKey): "ascending" | "descending" | "none" {
    if (sortKey !== key) return "none";
    return sortDirection === "asc" ? "ascending" : "descending";
  }

  function sortArrow(key: SortKey) {
    if (sortKey !== key) return null;
    return <span className="sort-arrow">{sortDirection === "asc" ? " ▲" : " ▼"}</span>;
  }

  return (
    <>
      <div className="order-toolbar">
        <input
          type="text"
          inputMode="numeric"
          className="order-search-input"
          placeholder="Hľadať podľa čísla objednávky…"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          aria-label="Hľadať podľa čísla objednávky"
        />

        <select
          className="sort-select"
          value={`${sortKey}:${sortDirection}`}
          onChange={(event) => {
            const [key, direction] = event.target.value.split(":") as [SortKey, SortDirection];
            setSortKey(key);
            setSortDirection(direction);
          }}
          aria-label="Zoradiť podľa"
        >
          <option value="createdAt:asc">Dátum vytvorenia (najstaršie prvé)</option>
          <option value="createdAt:desc">Dátum vytvorenia (najnovšie prvé)</option>
          <option value="deadline:asc">Deadline (najbližšie prvé)</option>
          <option value="deadline:desc">Deadline (najvzdialenejšie prvé)</option>
          <option value="orderNumber:asc">Číslo objednávky (vzostupne)</option>
          <option value="orderNumber:desc">Číslo objednávky (zostupne)</option>
        </select>

        {!isDefaultState && (
          <button type="button" className="reset-filters-button" onClick={handleReset}>
            Zrušiť filtre
          </button>
        )}
      </div>

      {visibleOrders.length === 0 ? (
        <p className="empty-state">Žiadna objednávka nezodpovedá hľadaniu.</p>
      ) : (
        <>
          <div className="order-cards">
            {visibleOrders.map((order) => (
              <OrderCard key={order.orderNumber} order={order} />
            ))}
          </div>

          <div className="order-table-wrapper">
            <table className="order-table">
              <thead>
                <tr>
                  <th aria-sort={ariaSortFor("orderNumber")}>
                    <button
                      type="button"
                      className="sort-header"
                      onClick={() => handleSortClick("orderNumber")}
                    >
                      Objednávka{sortArrow("orderNumber")}
                    </button>
                  </th>
                  <th className="order-table-nowrap-col" aria-sort={ariaSortFor("createdAt")}>
                    <button
                      type="button"
                      className="sort-header"
                      onClick={() => handleSortClick("createdAt")}
                    >
                      Vytvorená{sortArrow("createdAt")}
                    </button>
                  </th>
                  <th className="order-table-nowrap-col" aria-sort={ariaSortFor("deadline")}>
                    <button
                      type="button"
                      className="sort-header"
                      onClick={() => handleSortClick("deadline")}
                    >
                      Deadline{sortArrow("deadline")}
                    </button>
                  </th>
                  <th>Zákazník</th>
                  <th className="order-table-sku-col">SKU · KS</th>
                  <th>Dopravca</th>
                  <th>SAP</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => (
                  <OrderTableRow key={order.orderNumber} order={order} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// Riešenie "celý riadok/karta klikateľná, ale zachovaný stredný klik/Ctrl+klik/pravý
// klik/klávesnica aj označiteľnosť textu" (SPEC.md §4.1): pod celým riadkom leží
// neviditeľný odkaz cez celú plochu (position:absolute; inset:0), navrchu leží
// druhý, viditeľný odkaz len na čísle objednávky (position:relative, vyšší z-index)
// — vďaka tomu je číslo objednávky jediné miesto, kde myš "vidí" skutočný text
// (dá sa označiť/skopírovať), a jediný focusovateľný cieľ pre klávesnicu/čítačky
// (neviditeľný odkaz má tabIndex={-1} + aria-hidden, je len pre myš/dotyk).
// Rovnaký princíp treba použiť pri pridávaní ďalšieho interaktívneho prvku do
// riadku v budúcnosti (napr. tlačidlo) — position:relative + z-index nad
// ".row-link-overlay" ho vytiahne spod neviditeľného odkazu.
function OrderCard({ order }: { order: OrderRow }) {
  return (
    <div
      className={`order-card${order.sapDone ? "" : " order-card--pending-sap"}${
        order.overdue ? " order-card--overdue" : ""
      }`}
    >
      <a href={order.href} className="row-link-overlay" tabIndex={-1} aria-hidden="true" />

      <div className="order-card-top">
        <a href={order.href} className="order-number">
          {order.orderNumber}
        </a>
        <div className="order-card-dates">
          <span className="order-card-date">Vytvorená: {formatDate(order.createdAt)}</span>
          <span className={`order-card-date${order.overdue ? " deadline-overdue" : ""}`}>
            Deadline: {order.deliveryDeadline ? formatDate(order.deliveryDeadline) : "—"}
          </span>
        </div>
      </div>
      <div className="order-customer">{order.customerName}</div>
      <div className="order-items-count">{order.skuLabel}</div>
      <div className="order-badges">
        <span
          className={`badge ${order.carrier === "Packeta" ? "badge--carrier-zas" : "badge--carrier-gls"}`}
        >
          {order.carrierLabel}
        </span>
        {!order.sapDone && <span className="badge badge--sap-pending">čaká na SAP</span>}
      </div>
    </div>
  );
}

function OrderTableRow({ order }: { order: OrderRow }) {
  return (
    <tr
      className={`${order.sapDone ? "" : "order-row--pending-sap"}${
        order.overdue ? " order-row--overdue" : ""
      }`}
    >
      <td>
        <a href={order.href} className="row-link-overlay" tabIndex={-1} aria-hidden="true" />
        <a href={order.href} className="order-number-cell-link">
          {order.orderNumber}
        </a>
      </td>
      <td className="order-table-nowrap-col">{formatDate(order.createdAt)}</td>
      <td className={`order-table-nowrap-col${order.overdue ? " deadline-overdue" : ""}`}>
        {order.deliveryDeadline ? formatDate(order.deliveryDeadline) : "—"}
      </td>
      <td>{order.customerName}</td>
      <td className="order-table-sku-col">{order.skuLabel}</td>
      <td>
        <span
          className={`badge ${order.carrier === "Packeta" ? "badge--carrier-zas" : "badge--carrier-gls"}`}
        >
          {order.carrierLabel}
        </span>
      </td>
      <td>{order.sapDone ? "✓" : <span className="badge badge--sap-pending">čaká na SAP</span>}</td>
    </tr>
  );
}
