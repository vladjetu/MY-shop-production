import Link from "next/link";
import { formatDate } from "@/lib/format";
import { MatchedDesign, matchDesignsToLineItems } from "@/lib/match-designs";
import {
  ShopifyLineItem,
  ShopifyOrder,
  fetchOrderByNumber,
  getCarrier,
  getCarrierLabel,
  getTotalQuantity,
  hasSapProcessed,
} from "@/lib/shopify/orders";
import { ZakekeDesign, fetchOrderDesigns } from "@/lib/zakeke/designs";
import { ZoomableImage } from "@/components/ZoomableImage";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: { orderNumber: string };
}) {
  let order: ShopifyOrder | null = null;
  let loadError: string | null = null;
  let designs: ZakekeDesign[] = [];
  let designsError: string | null = null;

  const [orderResult, designsResult] = await Promise.allSettled([
    fetchOrderByNumber(params.orderNumber),
    fetchOrderDesigns(params.orderNumber),
  ]);

  if (orderResult.status === "fulfilled") {
    order = orderResult.value;
  } else {
    console.error("Nepodarilo sa načítať objednávku zo Shopify:", orderResult.reason);
    loadError =
      "Nepodarilo sa načítať objednávku zo Shopify. Skontroluj internetové pripojenie alebo to skús o chvíľu znova.";
  }

  if (designsResult.status === "fulfilled") {
    designs = designsResult.value;
  } else {
    console.error("Nepodarilo sa načítať dizajny zo Zakeke:", designsResult.reason);
    designsError =
      "Nepodarilo sa načítať dizajny zo Zakeke. Skontroluj internetové pripojenie alebo to skús o chvíľu znova.";
  }

  return (
    <>
      <Link href="/" className="back-link">
        ← Späť na zoznam
      </Link>

      {loadError && <div className="error-banner">{loadError}</div>}

      {!loadError && !order && <div className="error-banner">Objednávka sa nenašla.</div>}

      {!loadError && order && (
        <OrderDetail order={order} designs={designs} designsError={designsError} />
      )}
    </>
  );
}

function OrderDetail({
  order,
  designs,
  designsError,
}: {
  order: ShopifyOrder;
  designs: ZakekeDesign[];
  designsError: string | null;
}) {
  const sapDone = hasSapProcessed(order.tags);
  const carrier = getCarrier(order.tags);
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
        Dizajny ({order.lineItems.length} SKU · {getTotalQuantity(order)} ks spolu)
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
              <DesignCard key={`${matched.design.designId}-${index}`} matched={matched} index={index} />
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

function DesignCard({ matched, index }: { matched: MatchedDesign; index: number }) {
  const { design, lineItem } = matched;
  const sku = lineItem?.sku ?? design.productSku ?? "—";
  const productName = lineItem?.title ?? design.productName ?? "Neznámy produkt";
  const quantity = lineItem?.quantity ?? design.quantity;
  // Mockup na tričku (ak sa podarilo načítať) je pre výrobu prehľadnejší než holý
  // tlačový súbor — ak by neoficiálne API (viď internal-mockup-previews.ts) zlyhalo,
  // spadneme späť na reálne tlačové súbory, aby náhľad nezmizol úplne.
  const previewImages = design.mockups.length > 0 ? design.mockups : design.sides;

  return (
    <div className="design-card">
      <div className="design-card-header">
        <span className="design-index">D{index + 1}</span>
        <span className="design-id">Design ID: {design.designId}</span>
      </div>

      {previewImages.length > 0 ? (
        <div className="preview-grid">
          {previewImages.map((side) => (
            <ZoomableImage
              key={side.sideName}
              src={side.previewUrl}
              alt={`${productName} – ${side.sideName}`}
              label={side.sideName}
            />
          ))}
        </div>
      ) : (
        <p className="empty-state">
          Náhľad zatiaľ nie je pripravený (stav: {design.printFilesStatus ?? "neznámy"}).
        </p>
      )}

      <div className="design-sku">SKU: {sku}</div>
      <div className="design-meta">
        {productName}
        {lineItem?.variantTitle ? ` · ${lineItem.variantTitle}` : ""}
      </div>
      <div className="line-item-qty">Množstvo: {quantity} ks</div>

      {lineItem && (
        <div className="line-item-stock">
          <span>Sklad MERCHYOU: {lineItem.stockMerchyou ?? "—"}</span>
          <span>Sklad dodávateľa: {lineItem.stockSuppliers ?? "—"}</span>
        </div>
      )}
    </div>
  );
}

function LineItemCard({ item }: { item: ShopifyLineItem }) {
  return (
    <div className="line-item-card">
      <div className="line-item-title">{item.title}</div>
      {item.variantTitle && <div className="line-item-variant">{item.variantTitle}</div>}
      <div className="line-item-sku">SKU: {item.sku ?? "—"}</div>
      <div className="line-item-qty">Množstvo: {item.quantity} ks</div>
      <div className="line-item-stock">
        <span>Sklad MERCHYOU: {item.stockMerchyou ?? "—"}</span>
        <span>Sklad dodávateľa: {item.stockSuppliers ?? "—"}</span>
      </div>
    </div>
  );
}
