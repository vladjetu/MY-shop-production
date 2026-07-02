import { getCarrier, getSortedOrders, hasSapProcessed } from "@/lib/mock-orders";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("sk-SK", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

export default function HomePage() {
  const orders = getSortedOrders();

  return (
    <>
      <header className="app-header">
        <h1>MY shop production</h1>
        <form action="/api/logout" method="POST" className="logout-form">
          <button type="submit">Odhlásiť sa</button>
        </form>
      </header>

      <main className="app-main">
        <h2 className="page-title">Nevybavené objednávky ({orders.length})</h2>

        <div className="order-cards">
          {orders.map((order) => {
            const sapDone = hasSapProcessed(order.tags);
            const carrier = getCarrier(order.tags);

            return (
              <article
                key={order.orderNumber}
                className={`order-card${sapDone ? "" : " order-card--pending-sap"}`}
              >
                <div className="order-card-top">
                  <span className="order-number">{order.orderNumber}</span>
                  <span className="order-date">{formatDate(order.createdAt)}</span>
                </div>
                <div className="order-customer">{order.customerName}</div>
                <div className="order-items-count">
                  {order.itemsCount} {order.itemsCount === 1 ? "položka" : "položiek"}
                </div>
                <div className="order-badges">
                  <span
                    className={`badge ${
                      carrier === "Packeta" ? "badge--carrier-zas" : "badge--carrier-gls"
                    }`}
                  >
                    {carrier}
                    {carrier === "Packeta" && order.pickupPointName
                      ? ` · ${order.pickupPointName}`
                      : ""}
                  </span>
                  {!sapDone && <span className="badge badge--sap-pending">čaká na SAP</span>}
                </div>
              </article>
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
                <th>Položky</th>
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
                    <td>{order.orderNumber}</td>
                    <td>{formatDate(order.createdAt)}</td>
                    <td>{order.customerName}</td>
                    <td>{order.itemsCount}</td>
                    <td>
                      <span
                        className={`badge ${
                          carrier === "Packeta" ? "badge--carrier-zas" : "badge--carrier-gls"
                        }`}
                      >
                        {carrier}
                        {carrier === "Packeta" && order.pickupPointName
                          ? ` · ${order.pickupPointName}`
                          : ""}
                      </span>
                    </td>
                    <td>
                      {sapDone ? (
                        "✓"
                      ) : (
                        <span className="badge badge--sap-pending">čaká na SAP</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
