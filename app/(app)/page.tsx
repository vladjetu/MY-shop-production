import Link from "next/link";
import { formatDate, formatSlovakDayDate, isOverdue } from "@/lib/format";
import {
  ShopifyOrder,
  fetchUnfulfilledOrders,
  getCarrier,
  getCarrierLabel,
  getTotalQuantity,
  hasSapProcessed,
} from "@/lib/shopify/orders";
import { fetchOrderDesigns, fetchOrderNumbersWithDesigns } from "@/lib/zakeke/designs";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let orders: ShopifyOrder[] = [];
  let loadError: string | null = null;

  try {
    orders = await fetchUnfulfilledOrders();
  } catch (error) {
    console.error("Nepodarilo sa načítať objednávky zo Shopify:", error);
    loadError =
      "Nepodarilo sa načítať objednávky zo Shopify. Skontroluj internetové pripojenie alebo to skús o chvíľu znova.";
  }

  // Ak sa zistenie nepodarí, radšej to nezobrazíme vôbec (bezpečný predvolený stav),
  // než aby appka omylom označila objednávky s potlačou ako "Bez potlače".
  let orderNumbersWithDesigns: Set<string> | null = null;
  if (!loadError) {
    try {
      orderNumbersWithDesigns = await fetchOrderNumbersWithDesigns(
        orders.map((order) => order.orderNumber.replace("#", ""))
      );
    } catch (error) {
      console.error("Nepodarilo sa zistiť, ktoré objednávky majú potlač v Zakeke:", error);
    }
  }

  // Prefetch: predohrejeme cache (viď lib/cache.ts, TTL ~3 min) pre detail objednávok,
  // ktoré majú potlač, aby bol prechod na detail rýchly. Zámerne BEZ await — odskúšali
  // sme to aj s await a keď appka čakala na ~15-19 paralelných GraphQL dopytov na mockupy,
  // homepage sa spomalila z ~1s na 13s. Takto beží na pozadí; ak sa runtime ukončí skôr,
  // než dobehne, jednoducho sa nič neprehreje (bez dopadu na to, čo vidí používateľ).
  if (orderNumbersWithDesigns) {
    for (const orderNumber of orderNumbersWithDesigns) {
      fetchOrderDesigns(orderNumber).catch((error) => {
        console.error(`Prefetch dizajnov pre objednávku ${orderNumber} zlyhal:`, error);
      });
    }
  }

  function getSkuLabel(order: ShopifyOrder): string {
    const bareNumber = order.orderNumber.replace("#", "");
    if (orderNumbersWithDesigns && !orderNumbersWithDesigns.has(bareNumber)) {
      return "Bez potlače";
    }
    return `${order.lineItems.length} SKU · ${getTotalQuantity(order)} ks`;
  }

  return (
    <>
      <div className="page-header-row">
        <h2 className="page-title">
          Nevybavené objednávky{loadError ? "" : ` (${orders.length})`}
        </h2>
        <span className="current-date">{formatSlovakDayDate()}</span>
      </div>

      {loadError && <div className="error-banner">{loadError}</div>}

      {!loadError && orders.length === 0 && (
        <p className="empty-state">Žiadne nevybavené objednávky.</p>
      )}

      {!loadError && orders.length > 0 && (
        <>
          <div className="order-cards">
            {orders.map((order) => {
              const sapDone = hasSapProcessed(order.tags);
              const carrier = getCarrier(order.tags);
              const overdue = isOverdue(order.deliveryDeadline);

              return (
                <Link
                  key={order.orderNumber}
                  href={`/orders/${order.orderNumber.replace("#", "")}`}
                  className={`order-card${sapDone ? "" : " order-card--pending-sap"}${
                    overdue ? " order-card--overdue" : ""
                  }`}
                >
                  <div className="order-card-top">
                    <span className="order-number">{order.orderNumber}</span>
                    <div className="order-card-dates">
                      <span className="order-card-date">Vytvorená: {formatDate(order.createdAt)}</span>
                      <span className={`order-card-date${overdue ? " deadline-overdue" : ""}`}>
                        Deadline:{" "}
                        {order.deliveryDeadline ? formatDate(order.deliveryDeadline) : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="order-customer">{order.customerName}</div>
                  <div className="order-items-count">{getSkuLabel(order)}</div>
                  <div className="order-badges">
                    <span
                      className={`badge ${
                        carrier === "Packeta" ? "badge--carrier-zas" : "badge--carrier-gls"
                      }`}
                    >
                      {getCarrierLabel(order.tags, order.pickupPointName)}
                    </span>
                    {!sapDone && <span className="badge badge--sap-pending">čaká na SAP</span>}
                  </div>
                </Link>
              );
            })}
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
                {orders.map((order) => {
                  const sapDone = hasSapProcessed(order.tags);
                  const carrier = getCarrier(order.tags);
                  const overdue = isOverdue(order.deliveryDeadline);

                  return (
                    <tr
                      key={order.orderNumber}
                      className={`${sapDone ? "" : "order-row--pending-sap"}${
                        overdue ? " order-row--overdue" : ""
                      }`}
                    >
                      <td>
                        <Link href={`/orders/${order.orderNumber.replace("#", "")}`}>
                          {order.orderNumber}
                        </Link>
                      </td>
                      <td className="order-table-nowrap-col">{formatDate(order.createdAt)}</td>
                      <td className={`order-table-nowrap-col${overdue ? " deadline-overdue" : ""}`}>
                        {order.deliveryDeadline ? formatDate(order.deliveryDeadline) : "—"}
                      </td>
                      <td>{order.customerName}</td>
                      <td className="order-table-sku-col">{getSkuLabel(order)}</td>
                      <td>
                        <span
                          className={`badge ${
                            carrier === "Packeta" ? "badge--carrier-zas" : "badge--carrier-gls"
                          }`}
                        >
                          {getCarrierLabel(order.tags, order.pickupPointName)}
                        </span>
                      </td>
                      <td>
                        {sapDone ? "✓" : <span className="badge badge--sap-pending">čaká na SAP</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
