import { formatSlovakDayDate, isOverdue } from "@/lib/format";
import {
  ShopifyOrder,
  fetchUnfulfilledOrders,
  getCarrier,
  getCarrierLabel,
  getTotalQuantity,
  hasSapProcessed,
} from "@/lib/shopify/orders";
import { fetchOrderDesigns, fetchOrderNumbersWithDesigns } from "@/lib/zakeke/designs";
import { OrdersList, OrderRow } from "@/components/OrdersList";

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

  // Triedenie/vyhľadávanie sa rieši na klientovi (rádovo desiatky objednávok, ďalší
  // request na server by bol zbytočný) — sem sa preto pripraví len obyčajné,
  // serializovateľné pole (žiadne funkcie/Set), ktoré prevezme klientský komponent.
  const orderRows: OrderRow[] = orders.map((order) => {
    const bareNumber = order.orderNumber.replace("#", "");
    return {
      orderNumber: order.orderNumber,
      orderNumberValue: Number(bareNumber),
      href: `/orders/${bareNumber}`,
      createdAt: order.createdAt,
      customerName: order.customerName,
      skuLabel: getSkuLabel(order),
      carrier: getCarrier(order.tags),
      carrierLabel: getCarrierLabel(order.tags, order.pickupPointName),
      sapDone: hasSapProcessed(order.tags),
      deliveryDeadline: order.deliveryDeadline,
      overdue: isOverdue(order.deliveryDeadline),
    };
  });

  // Rovnaké pole order.overdue, aké čítajú karty/riadky na červené zvýraznenie
  // (isOverdue, lib/format.ts) — číslo v pille sa preto nemôže s nimi rozísť.
  // Počíta sa zo VŠETKÝCH zobrazených objednávok (triedenie poradie nemení,
  // takže zaškrtnutie "Zoradiť podľa deadline" na počet nemá vplyv).
  const overdueCount = orderRows.filter((row) => row.overdue).length;

  return (
    <>
      <div className="page-header-row">
        <h2 className="page-title">
          Nevybavené objednávky{loadError ? "" : ` (${orders.length})`}
        </h2>
        {/* Nula sa zámerne nezobrazuje vôbec (nie sivý "0") — pill je tu na to,
            aby upútal pozornosť na problém; keď žiadny nie je, netreba
            zobrazovať, že nie je, viď SPEC.md §4.1. */}
        {!loadError && overdueCount > 0 && (
          <span className="badge badge--overdue-count">
            Objednávky po deadline: {overdueCount}
          </span>
        )}
        <span className="current-date">{formatSlovakDayDate()}</span>
      </div>

      {loadError && <div className="error-banner">{loadError}</div>}

      {!loadError && orders.length === 0 && (
        <p className="empty-state">Žiadne nevybavené objednávky.</p>
      )}

      {!loadError && orders.length > 0 && <OrdersList orders={orderRows} />}
    </>
  );
}
