import Link from "next/link";
import { Suspense } from "react";
import { formatDate, isOverdue } from "@/lib/format";
import { matchDesignsToLineItems } from "@/lib/match-designs";
import {
  ShopifyLineItem,
  ShopifyOrder,
  fetchOrderByNumber,
  getCarrier,
  getCarrierLabel,
  getTotalQuantity,
  hasSapProcessed,
} from "@/lib/shopify/orders";
import { printedItemKey } from "@/lib/shopify/printed-items";
import { fetchOrderDesigns } from "@/lib/zakeke/designs";
import { DesignCard } from "@/components/DesignCard";

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

      {!loadError && order && (
        <>
          <OrderHeader order={order} />
          {/* Hlavička (Shopify) sa vykreslí hneď; dizajny zo Zakeke (pomalší mockup
              dopyt) sa doťahujú na pozadí a kým nie sú hotové, zobrazí sa skeleton. */}
          <Suspense fallback={<DesignsSkeleton />}>
            <DesignsSection order={order} />
          </Suspense>
        </>
      )}
    </>
  );
}

function OrderHeader({ order }: { order: ShopifyOrder }) {
  const sapDone = hasSapProcessed(order.tags);
  const carrier = getCarrier(order.tags);
  const overdue = isOverdue(order.deliveryDeadline);

  return (
    <div className={`order-detail-header${overdue ? " order-detail-header--overdue" : ""}`}>
      <h2>{order.orderNumber}</h2>

      <div className="order-detail-dates">
        <div className="detail-stat">
          <span className="detail-stat-label">Vytvorená</span>
          <span className="detail-stat-value">{formatDate(order.createdAt)}</span>
        </div>
        <div className={`detail-stat${overdue ? " detail-stat--overdue" : ""}`}>
          <span className="detail-stat-label">Deadline</span>
          <span className="detail-stat-value">
            {order.deliveryDeadline ? formatDate(order.deliveryDeadline) : "—"}
          </span>
        </div>
      </div>

      <div className="order-detail-meta">
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
  );
}

async function DesignsSection({ order }: { order: ShopifyOrder }) {
  let designs: Awaited<ReturnType<typeof fetchOrderDesigns>> = [];
  let designsError: string | null = null;

  try {
    designs = await fetchOrderDesigns(order.orderNumber.replace("#", ""));
  } catch (error) {
    console.error("Nepodarilo sa načítať dizajny zo Zakeke:", error);
    designsError =
      "Nepodarilo sa načítať dizajny zo Zakeke. Skontroluj internetové pripojenie alebo to skús o chvíľu znova.";
  }

  const matchedDesigns = matchDesignsToLineItems(designs, order.lineItems);
  const matchedLineItemIds = new Set(
    matchedDesigns
      .map((matched) => matched.lineItem?.id)
      .filter((id): id is string => Boolean(id))
  );
  const unmatchedLineItems = order.lineItems.filter(
    (item) => !matchedLineItemIds.has(item.id)
  );

  return (
    <>
      <h3 className="section-title">
        Položky ({order.lineItems.length} SKU · {getTotalQuantity(order)} ks spolu)
      </h3>

      {designsError && <div className="error-banner">{designsError}</div>}

      {!designsError && designs.length === 0 && (
        <>
          <p className="empty-state">Iba textil bez potlače.</p>
          <div className="line-items">
            {order.lineItems.map((item) => (
              <LineItemCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}

      {!designsError && designs.length > 0 && (
        <>
          <div className="design-cards">
            {matchedDesigns.map((matched, index) => (
              <DesignCard
                key={`${matched.design.designId}-${index}`}
                matched={matched}
                index={index}
                orderNumber={order.orderNumber.replace("#", "")}
                initialPrinted={order.printedItemKeys.includes(
                  printedItemKey(matched.design.productSku, matched.design.designId)
                )}
              />
            ))}
          </div>

          {unmatchedLineItems.length > 0 && (
            <>
              <h3 className="section-title">Ostatné položky (bez personalizácie)</h3>
              <div className="line-items">
                {unmatchedLineItems.map((item) => (
                  <LineItemCard key={item.id} item={item} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function DesignsSkeleton() {
  return (
    <>
      <h3 className="section-title">Položky</h3>
      <div className="design-cards">
        {[1, 2].map((i) => (
          <div key={i} className="design-card skeleton-card" aria-hidden="true">
            <div className="skeleton-line skeleton-line--short" />
            <div className="skeleton-line skeleton-line--medium" />
            <div className="skeleton-line skeleton-line--long" />
            <div className="skeleton-preview" />
          </div>
        ))}
      </div>
    </>
  );
}

function LineItemCard({ item }: { item: ShopifyLineItem }) {
  return (
    <div className="line-item-card">
      <div className="info-stack">
        <div className="line-item-title">{item.title}</div>
        {item.variantTitle && <span className="variant-chip">{item.variantTitle}</span>}
        <div className="line-item-sku">SKU: {item.sku ?? "—"}</div>
        <div className="line-item-qty">Množstvo: {item.quantity} ks</div>
        <div className="line-item-stock">
          <span>Sklad MERCHYOU: {item.stockMerchyou ?? "—"}</span>
          <span>Sklad dodávateľa: {item.stockSuppliers ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}
