import Link from "next/link";
import { Suspense, cache } from "react";
import { formatDate, isOverdue } from "@/lib/format";
import { matchDesignsToLineItems } from "@/lib/match-designs";
import {
  CarrierBadge,
  carrierBadgeClass,
  formatSapChangedAt,
  formatZlShortList,
  sapCarrierGroups,
  sapStatusView,
  sapUserInitials,
  shortDocNum,
} from "@/lib/sap/display";
import { CardZlMatch, matchOrderToZl, skusNeedingProductLookup } from "@/lib/sap/match";
import { getSapSnapshot } from "@/lib/sap/snapshot";
import type { SapOrder } from "@/lib/sap/types";
import {
  ShopifyLineItem,
  ShopifyOrder,
  fetchOrderByNumber,
  fetchOriginalProductIdBySku,
  getShopifyCarrierBadge,
  getTotalQuantity,
  hasSapProcessed,
} from "@/lib/shopify/orders";
import { printedItemKey } from "@/lib/shopify/printed-items";
import { ZakekeDesign, fetchOrderDesigns } from "@/lib/zakeke/designs";
import { DesignCard } from "@/components/DesignCard";
import { ProductionNote } from "@/components/ProductionNote";
import { ItemSap, SapChangedTextile, SapZlRow, SapZlStatus } from "@/components/SapZlStatus";

export const dynamic = "force-dynamic";

// SAP ZL objednávky zo snapshotu (docs/SAP-INTEGRATION.md §9). null = snapshot
// nie je k dispozícii → detail sa správa ako pred SAP integráciou.
type OrderSap = { syncedAt: string; zls: SapOrder[] } | null;

// cache() = jeden výpočet na request, zdieľaný hlavičkou (nespárované ZL) aj
// sekciou položiek — inak by sa Zakeke dizajny aj párovanie ťahali dvakrát.
const loadOrderSap = cache(async (orderName: string): Promise<OrderSap> => {
  const snapshot = await getSapSnapshot();
  if (!snapshot) return null;
  return { syncedAt: snapshot.syncedAt, zls: snapshot.byOrderName[orderName] ?? [] };
});

const loadOrderDesigns = cache((bareOrderNumber: string) => fetchOrderDesigns(bareOrderNumber));

// Položky bez personalizácie (karty LineItemCard): bez Zakeke dizajnov všetky,
// inak tie, ku ktorým sa nenašiel dizajn.
function nonPersonalizedItems(order: ShopifyOrder, designs: ZakekeDesign[]): ShopifyLineItem[] {
  if (designs.length === 0) return order.lineItems;
  const matchedIds = new Set(
    matchDesignsToLineItems(designs, order.lineItems)
      .map((matched) => matched.lineItem?.id)
      .filter((id): id is string => Boolean(id))
  );
  return order.lineItems.filter((item) => !matchedIds.has(item.id));
}

const loadZlMatch = cache(async (order: ShopifyOrder) => {
  const designs = await loadOrderDesigns(order.orderNumber.replace("#", ""));
  const sap = await loadOrderSap(order.orderNumber);
  if (!sap || sap.zls.length === 0) return null;
  const textileItems = nonPersonalizedItems(order, designs);

  const cards = designs.map((design) => ({
    designId: design.designId,
    sku: design.productSku,
    quantity: design.quantity,
  }));

  // Dohľadanie originálneho produktu (§7 krok 2) len pri ZL bez histórie. Výpadok
  // Shopify tu párovanie nezhodí — krok 2 sa len preskočí.
  let productIdBySku = new Map<string, string>();
  const lookupSkus = skusNeedingProductLookup(cards, sap.zls);
  if (lookupSkus.length > 0) {
    try {
      productIdBySku = await fetchOriginalProductIdBySku(lookupSkus);
    } catch (error) {
      console.error("SAP párovanie: dohľadanie originálnych produktov zlyhalo:", error);
    }
  }

  const match = matchOrderToZl(
    cards,
    textileItems.map((item) => ({ sku: item.sku, quantity: item.quantity })),
    sap.zls,
    productIdBySku
  );
  return {
    cards: match.cards,
    textileByLineItemId: new Map(textileItems.map((item, i) => [item.id, match.textileItems[i]])),
    unmatchedZls: match.unmatchedZls,
  };
});

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
          <OrderHeader order={order} sap={await loadOrderSap(order.orderNumber)} />
          <ProductionNote
            orderNumber={order.orderNumber.replace("#", "")}
            initialNote={order.productionNote}
          />
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

// Tagy, ktoré appka už zobrazuje inde vo vlastnej, zrozumiteľnejšej podobe
// (SAP indikátor a dopravca s pobočkou nižšie) — v surovom zozname tagov by
// boli duplicitné a zbytočne zaberali miesto.
const HANDLED_TAGS = new Set(["sap processed", "zasilkovna_selected", "zasilkovna_unselected"]);

function OrderHeader({ order, sap }: { order: ShopifyOrder; sap: OrderSap }) {
  const sapDone = hasSapProcessed(order.tags);
  const overdue = isOverdue(order.deliveryDeadline);
  const otherTags = order.tags.filter((tag) => !HANDLED_TAGS.has(tag.trim().toLowerCase()));
  const sapZls = sap?.zls ?? [];

  // Dopravca zo SAP, ak má objednávka ZL, inak podľa Shopify tagov (§10.2).
  // Pobočka Packety len pri kóde 11; ak ju SAP nemá, fallback na Shopify.
  const carrierGroups: (CarrierBadge & { docNums: number[] })[] =
    sapZls.length > 0
      ? sapCarrierGroups(sapZls).map((group) => ({
          key: group.key,
          label:
            group.key === "packeta"
              ? withPickupPoint(group.label, group.pickupPointName ?? order.pickupPointName)
              : group.label,
          docNums: group.docNums,
        }))
      : [{ ...getShopifyCarrierBadge(order.tags, order.pickupPointName), docNums: [] }];

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
        {carrierGroups.length === 1 && <CarrierBadgeView carrier={carrierGroups[0]} />}
        {sapDone ? (
          <span className="tag-chip">SAP ✓</span>
        ) : (
          <span className="badge badge--sap-pending">čaká na SAP</span>
        )}
      </div>

      {/* Viac dopravcov → riadok na každého s číslami jeho ZL ("GLS – ZL 4819, 4820"). */}
      {carrierGroups.length > 1 && (
        <div className="sap-header-rows">
          {carrierGroups.map((carrier) => (
            <div key={carrier.key + carrier.label} className="sap-carrier-row">
              <CarrierBadgeView carrier={carrier} />
              <span>– ZL {formatZlShortList(carrier.docNums)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ZL bez priradenej položky potrebujú Zakeke dizajny — doťahujú sa na
          pozadí (rovnaký cache() výpočet ako sekcia položiek), hlavička nečaká.
          Čistý textil sa zobrazuje na kartách položiek, nie tu. */}
      {sap && sapZls.length > 0 && (
        <Suspense fallback={null}>
          <UnmatchedZlRows order={order} syncedAt={sap.syncedAt} />
        </Suspense>
      )}

      {order.note && <p className="order-note">Poznámka Zákazník: {order.note}</p>}

      {otherTags.length > 0 && (
        <div className="order-tags">
          {otherTags.map((tag) => (
            <span key={tag} className="tag-chip">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function withPickupPoint(label: string, pickupPointName: string | undefined | null): string {
  return pickupPointName ? `${label} · ${pickupPointName}` : label;
}

function CarrierBadgeView({ carrier }: { carrier: CarrierBadge }) {
  return <span className={`badge ${carrierBadgeClass(carrier.key)}`}>{carrier.label}</span>;
}

async function UnmatchedZlRows({ order, syncedAt }: { order: ShopifyOrder; syncedAt: string }) {
  let unmatched: SapOrder[] = [];
  try {
    unmatched = (await loadZlMatch(order))?.unmatchedZls ?? [];
  } catch {
    // Zakeke zlyhalo — chybu ukazuje sekcia položiek, hlavička len vynechá tento riadok.
    return null;
  }
  if (unmatched.length === 0) return null;

  return (
    <div className="sap-header-rows">
      {unmatched.map((zl) => {
        const status = sapStatusView(zl.status, syncedAt);
        const descriptions = zl.lines
          .map((line) => line.description ?? line.itemCode)
          .filter((text): text is string => Boolean(text));
        return (
          <div key={zl.docEntry} className={`sap-zl-row${status.stale ? " sap-zl-row--stale" : ""}`}>
            <span className="sap-zl-number">
              <span className="sap-zl-label">ZL bez priradenej položky:</span> ZL {shortDocNum(zl.docNum)}
              {descriptions.length > 0 && <span className="sap-zl-lines"> · {descriptions.join(", ")}</span>}
            </span>
            <SapZlStatus status={status} />
          </div>
        );
      })}
    </div>
  );
}

// Serializovateľné SAP údaje pre kartu položky (§10.3) — personalizovanej aj
// čistého textilu.
function itemSap(match: CardZlMatch | null, sap: OrderSap): ItemSap | null {
  if (!sap || sap.zls.length === 0) return null;
  if (!match) return { kind: "unassigned" };

  let changedTextile: Extract<ItemSap, { kind: "assigned" }>["changedTextile"] = null;
  if (match.changedLines) {
    const change = match.method === "original" ? match.zl.textileChange : null;
    // Pri fallbacku (§7 kroky 2–3) appka čas zmeny nepozná — chip je bez času.
    // Autor len iniciálami (v snapshote je celé meno).
    const initials = change ? sapUserInitials(change.changedBy) : null;
    const note =
      match.method === "elimination"
        ? "Zmenené v SAP · skontroluj"
        : change
          ? `Zmenené v SAP ${formatSapChangedAt(change.changedAt)}${initials ? ` · ${initials}` : ""}`
          : "Zmenené v SAP";
    changedTextile = {
      lines: match.changedLines.map(({ description, itemCode, quantity }) => ({
        description: description ?? itemCode ?? "—",
        quantity,
      })),
      note,
    };
  }

  return {
    kind: "assigned",
    docNum: match.zl.docNum,
    status: sapStatusView(match.zl.status, sap.syncedAt),
    changedTextile,
  };
}

async function DesignsSection({ order }: { order: ShopifyOrder }) {
  let designs: Awaited<ReturnType<typeof fetchOrderDesigns>> = [];
  let designsError: string | null = null;

  try {
    designs = await loadOrderDesigns(order.orderNumber.replace("#", ""));
  } catch (error) {
    console.error("Nepodarilo sa načítať dizajny zo Zakeke:", error);
    designsError =
      "Nepodarilo sa načítať dizajny zo Zakeke. Skontroluj internetové pripojenie alebo to skús o chvíľu znova.";
  }

  const matchedDesigns = matchDesignsToLineItems(designs, order.lineItems);
  const sap = await loadOrderSap(order.orderNumber);
  const zlMatch = designsError ? null : await loadZlMatch(order);
  const unmatchedLineItems = nonPersonalizedItems(order, designs);
  const lineItemSap = (item: ShopifyLineItem) =>
    itemSap(zlMatch?.textileByLineItemId.get(item.id) ?? null, sap);

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
              <LineItemCard key={item.id} item={item} sap={lineItemSap(item)} />
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
                sap={itemSap(zlMatch?.cards[index] ?? null, sap)}
              />
            ))}
          </div>

          {unmatchedLineItems.length > 0 && (
            <>
              <h3 className="section-title">Ostatné položky (bez personalizácie)</h3>
              <div className="line-items">
                {unmatchedLineItems.map((item) => (
                  <LineItemCard key={item.id} item={item} sap={lineItemSap(item)} />
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

// Karta položky bez personalizácie. Hlavičkou je názov produktu; riadok ZL
// (čistý textil, docType "3") je pod ňou rovnako ako na karte dizajnu.
function LineItemCard({ item, sap }: { item: ShopifyLineItem; sap: ItemSap | null }) {
  const changedTextile = sap?.kind === "assigned" ? sap.changedTextile : null;
  return (
    <div className="line-item-card">
      <div className="line-item-title">{item.title}</div>
      {sap && <SapZlRow sap={sap} />}
      <div className="info-stack line-item-info">
        {changedTextile ? (
          <SapChangedTextile
            changedTextile={changedTextile}
            originalSku={item.sku}
            originalVariant={item.variantTitle ?? item.title}
          />
        ) : (
          <>
            {item.variantTitle && <span className="variant-chip">{item.variantTitle}</span>}
            <div className="line-item-sku">SKU: {item.sku ?? "—"}</div>
            <div className="line-item-qty">Množstvo: {item.quantity} ks</div>
            <div className="line-item-stock">
              <span>Sklad MERCHYOU: {item.stockMerchyou ?? "—"}</span>
              <span>Sklad dodávateľa: {item.stockSuppliers ?? "—"}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
