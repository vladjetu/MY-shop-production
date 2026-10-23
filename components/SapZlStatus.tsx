import type { SapStatusView } from "@/lib/sap/display";

// SAP údaje jednej karty položky (personalizovanej aj čistého textilu),
// pripravené na serveri (docs/SAP-INTEGRATION.md §7, §10.3). null = objednávka
// nemá v SAP snapshote žiadne ZL → karta ako pred integráciou.
export type ItemSap =
  | { kind: "unassigned" }
  | {
      kind: "assigned";
      docNum: number;
      status: SapStatusView;
      // Aktuálny textil zo SAP, ak sa líši od Shopify; inak null.
      changedTextile: {
        lines: { description: string; quantity: number }[];
        // "Zmenené v SAP 19. 10. 2026 12:25 · VH" (bez času pri fallbacku).
        note: string;
      } | null;
    };

// Pill so stavom zákazky zo SAP + drobný čas poslednej synchronizácie. Pill a čas
// tvoria jeden celok, ktorý sa na úzkom displeji zalomí pod číslo ZL ako celok.
// ZL bez stavu v SAP → len čas, bez pillu.
export function SapZlStatus({ status }: { status: SapStatusView }) {
  return (
    <span className="sap-zl-status">
      {status.label && (
        <span className={`sap-status-pill${status.warning ? " sap-status-pill--warning" : ""}`}>
          {status.label}
        </span>
      )}
      <span className="sap-synced-at" title={status.stale ? "SAP dáta sú staršie ako 60 min" : undefined}>
        {status.syncedText}
      </span>
    </span>
  );
}

// Samostatný riadok „ZL: 212604819 [stav] aktualizované …“ pod hlavičkou karty.
// Neaktuálne dáta (> 60 min) celý riadok len spriehľadnia — menej dôležitý
// údaj, nie chyba, preto žiadna výstražná farba.
export function SapZlRow({ sap }: { sap: ItemSap }) {
  if (sap.kind === "unassigned") {
    return (
      <div className="sap-zl-row sap-zl-row--card">
        <span className="sap-zl-number sap-zl-number--unassigned">ZL: nepriradené</span>
      </div>
    );
  }
  return (
    <div className={`sap-zl-row sap-zl-row--card${sap.status.stale ? " sap-zl-row--stale" : ""}`}>
      <span className="sap-zl-number">ZL: {sap.docNum}</span>
      <SapZlStatus status={sap.status} />
    </div>
  );
}

// Textil zmenený v SAP: hlavný údaj je aktuálny textil zo SAP (SAP je zdroj
// pravdy pre to, čo sa vyrába), pod ním chip so zmenou a prečiarknutý pôvodný
// Shopify variant so SKU. Skladové hodnoty Shopify sa vtedy nezobrazujú —
// patria k pôvodnému SKU, nie k tomu, čo sa vyrába.
export function SapChangedTextile({
  changedTextile,
  originalSku,
  originalVariant,
}: {
  changedTextile: NonNullable<Extract<ItemSap, { kind: "assigned" }>["changedTextile"]>;
  originalSku: string | null;
  originalVariant: string;
}) {
  return (
    <>
      {changedTextile.lines.length > 0 ? (
        changedTextile.lines.map((line, lineIndex) => (
          <div key={lineIndex} className="sap-textile-line">
            <div className="design-product-name">{line.description}</div>
            <div className="line-item-qty">Množstvo: {line.quantity} ks</div>
          </div>
        ))
      ) : (
        <div className="design-product-name">Položka už v ZL nie je</div>
      )}
      <span className="sap-change-chip">{changedTextile.note}</span>
      <span className="sap-original-textile">
        pôvodne objednané: {[originalSku, originalVariant].filter(Boolean).join(" ")}
      </span>
    </>
  );
}
