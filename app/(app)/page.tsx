import Link from "next/link";
import { formatDate } from "@/lib/format";
import {
  ShopifyOrder,
  fetchUnfulfilledOrders,
  getCarrier,
  getCarrierLabel,
  getTotalQuantity,
  hasSapProcessed,
} from "@/lib/shopify/orders";
import { fetchOrderNumbersWithDesigns } from "@/lib/zakeke/designs";

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

  function getSkuLabel(order: ShopifyOrder): string {
    const bareNumber = order.orderNumber.replace("#", "");
    if (orderNumbersWithDesigns && !orderNumbersWithDesigns.has(bareNumber)) {
      return "Bez potlače";
    }
    return `${order.lineItems.length} SKU · ${getTotalQuantity(order)} ks`;
  }

  return (
    <>
      <h2 className="page-title">
        Nevybavené objednávky{loadError ? "" : ` (${orders.length})`}
      </h2>

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

              return (
                <Link
                  key={order.orderNumber}
                  href={`/orders/${order.orderNumber.replace("#", "")}`}
                  className={`order-card${sapDone ? "" : " order-card--pending-sap"}`}
                >
                  <div className="order-card-top">
                    <span className="order-number">{order.orderNumber}</span>
                    <span className="order-date">{formatDate(order.createdAt)}</span>
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
                  <th>Dátum</th>
                  <th>Zákazník</th>
                  <th>SKU / ks</th>
                  <th>Dopravca</th>
                  <th>SAP</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const sapDone = hasSapProcessed(order.tags);
                  const carrier = getCarrier(order.tags);

                  return (
                    <tr
                      key={order.orderNumber}
                      className={sapDone ? "" : "order-row--pending-sap"}
                    >
                      <td>
                        <Link href={`/orders/${order.orderNumber.replace("#", "")}`}>
                          {order.orderNumber}
                        </Link>
                      </td>
                      <td>{formatDate(order.createdAt)}</td>
                      <td>{order.customerName}</td>
                      <td>{getSkuLabel(order)}</td>
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
