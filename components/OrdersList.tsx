"use client";

import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { compareOrders } from "@/lib/order-sort";

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

export function OrdersList({ orders }: { orders: OrderRow[] }) {
  // Jediná voľba: predvolený stav (dátum vytvorenia, najstaršie hore) alebo
  // zoradenie podľa deadlinu (najbližšie hore, chýbajúce vždy na konci —
  // lib/order-sort.ts). Odškrtnutie checkboxu je zároveň jeho vlastný reset,
  // netreba naň samostatné tlačidlo.
  const [sortByDeadline, setSortByDeadline] = useState(false);

  const visibleOrders = useMemo(() => {
    const key = sortByDeadline ? "deadline" : "createdAt";
    return [...orders].sort((a, b) => compareOrders(a, b, key, "asc"));
  }, [orders, sortByDeadline]);

  // Rovnaké pole order.overdue, aké čítajú karty/riadky nižšie na červené
  // zvýraznenie (isOverdue, lib/format.ts) — číslo v pille sa preto nemôže
  // s nimi rozísť. Počíta sa zo VŠETKÝCH objednávok, nie z visibleOrders
  // (triedenie mení len poradie, nie počet).
  const overdueCount = useMemo(
    () => orders.filter((order) => order.overdue).length,
    [orders],
  );

  return (
    <>
      {/* Obe ovládanie súvisiace s deadlinom v jednom riadku — nadpis stránky
          a dátum (page.tsx) ostávajú na svojej vlastnej úrovni vyššie. */}
      <div className="order-toolbar">
        <label className="deadline-sort-toggle">
          <input
            type="checkbox"
            checked={sortByDeadline}
            onChange={(event) => setSortByDeadline(event.target.checked)}
          />
          <span>Zoradiť podľa deadline</span>
        </label>

        {/* Nula sa zámerne nezobrazuje vôbec (nie sivý "0") — pill je tu na to,
            aby upútal pozornosť na problém; keď žiadny nie je, netreba
            zobrazovať, že nie je, viď SPEC.md §4.1. */}
        {overdueCount > 0 && (
          <span className="badge badge--overdue-count">
            Objednávky po deadline: {overdueCount}
          </span>
        )}
      </div>

      <div className="order-cards">
        {visibleOrders.map((order) => (
          <OrderCard key={order.orderNumber} order={order} />
        ))}
      </div>

      <div className="order-table-wrapper">
        <table className="order-table">
          <thead>
            <tr>
              <th>Objednávka</th>
              <th className="order-table-nowrap-col">Vytvorená</th>
              <th className="order-table-nowrap-col">Deadline</th>
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
      <a
        href={order.href}
        className="row-link-overlay"
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="order-card-top">
        <a href={order.href} className="order-number">
          {order.orderNumber}
        </a>
        <div className="order-card-dates">
          <span className="order-card-date">
            Vytvorená: {formatDate(order.createdAt)}
          </span>
          <span
            className={`order-card-date${order.overdue ? " deadline-overdue" : ""}`}
          >
            Deadline:{" "}
            {order.deliveryDeadline ? formatDate(order.deliveryDeadline) : "—"}
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
        {!order.sapDone && (
          <span className="badge badge--sap-pending">čaká na SAP</span>
        )}
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
        <a
          href={order.href}
          className="row-link-overlay"
          tabIndex={-1}
          aria-hidden="true"
        />
        <a href={order.href} className="order-number-cell-link">
          {order.orderNumber}
        </a>
      </td>
      <td className="order-table-nowrap-col">{formatDate(order.createdAt)}</td>
      <td
        className={`order-table-nowrap-col${order.overdue ? " deadline-overdue" : ""}`}
      >
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
      <td>
        {order.sapDone ? (
          "✓"
        ) : (
          <span className="badge badge--sap-pending">čaká na SAP</span>
        )}
      </td>
    </tr>
  );
}
