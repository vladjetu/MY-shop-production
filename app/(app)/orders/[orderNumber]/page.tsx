import Link from "next/link";
import { formatDate } from "@/lib/format";
import {
  ShopifyOrder,
  fetchOrderByNumber,
  getCarrier,
  getCarrierLabel,
  getTotalQuantity,
  hasSapProcessed,
} from "@/lib/shopify/orders";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: { orderNumber: string };
}) {
  let order: ShopifyOrder | null = null;
  let loadError: string | null = null;

  try {
    order = await fetchOrderByNumber(params.orderNumber);
  } catch (error) {
    console.error("Nepodarilo sa načítať objednávku zo Shopify:", error);
    loadError =
      "Nepodarilo sa načítať objednávku zo Shopify. Skontroluj internetové pripojenie alebo to skús o chvíľu znova.";
  }

  return (
    <>
      <Link href="/" className="back-link">
        ← Späť na zoznam
      </Link>

      {loadError && <div className="error-banner">{loadError}</div>}

      {!loadError && !order && <div className="error-banner">Objednávka sa nenašla.</div>}

      {!loadError && order && <OrderDetail order={order} />}
    </>
  );
}

function OrderDetail({ order }: { order: ShopifyOrder }) {
  const sapDone = hasSapProcessed(order.tags);
  const carrier = getCarrier(order.tags);

  return (
    <>
      <div className="order-detail-header">
        <h2>{order.orderNumber}</h2>
        <div className="order-detail-meta">
          <span>{formatDate(order.createdAt)}</span>
          <span>{order.customerName}</span>
          <span
            className={`badge ${
              carrier === "Packeta" ? "badge--carrier-zas" : "badge--carrier-gls"
            }`}
          >
            {getCarrierLabel(order.tags, order.pickupPointName)}
          </span>
          {!sapDone && <span className="badge badge--sap-pending">čaká na SAP</span>}
        </div>

        {order.note && <p className="order-note">Poznámka: {order.note}</p>}

        {order.tags.length > 0 && (
          <div className="order-tags">
            {order.tags.map((tag) => (
              <span key={tag} className="tag-chip">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <h3 className="section-title">
        Položky ({order.lineItems.length} SKU · {getTotalQuantity(order)} ks spolu)
      </h3>

      <div className="line-items">
        {order.lineItems.map((item) => (
          <div key={item.id} className="line-item-card">
            <div className="line-item-title">{item.title}</div>
            {item.variantTitle && <div className="line-item-variant">{item.variantTitle}</div>}
            <div className="line-item-sku">SKU: {item.sku ?? "—"}</div>
            <div className="line-item-qty">Množstvo: {item.quantity} ks</div>
            <div className="line-item-stock">
              <span>Sklad MERCHYOU: {item.stockMerchyou ?? "—"}</span>
              <span>Sklad dodávateľa: {item.stockSuppliers ?? "—"}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
