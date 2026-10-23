"use client";

import { useEffect, useRef, useState } from "react";
import { MatchedDesign } from "@/lib/match-designs";
import { printedItemKey } from "@/lib/shopify/printed-items";
import { sideLabels } from "@/lib/side-labels";
import { ItemSap, SapChangedTextile, SapZlRow } from "@/components/SapZlStatus";
import { ZoomableImage } from "@/components/ZoomableImage";

export function DesignCard({
  matched,
  index,
  orderNumber,
  initialPrinted,
  sap,
}: {
  matched: MatchedDesign;
  index: number;
  orderNumber: string;
  initialPrinted: boolean;
  sap: ItemSap | null;
}) {
  const { design, lineItem } = matched;
  const sku = lineItem?.sku ?? design.productSku ?? "—";
  const productName =
    lineItem?.title ?? design.productName ?? "Neznámy produkt";
  const quantity = lineItem?.quantity ?? design.quantity;
  // Mockup na tričku (ak sa podarilo načítať) je pre výrobu prehľadnejší než holý
  // tlačový súbor — ak by neoficiálne API (viď internal-mockup-previews.ts) zlyhalo,
  // spadneme späť na reálne tlačové súbory, aby náhľad nezmizol úplne.
  const previewImages =
    design.mockups.length > 0 ? design.mockups : design.sides;
  const previewLabels = sideLabels(previewImages);
  const downloadLabels = sideLabels(design.sides);
  const itemKey = printedItemKey(design.productSku, design.designId);
  const changedTextile = sap?.kind === "assigned" ? sap.changedTextile : null;

  const [printed, setPrinted] = useState(initialPrinted);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Odznačenie (nastavenie na "nevytlačené") si vyžaduje potvrdenie — jednoduchý
  // dotyk pri stroji (napr. v rukaviciach) by inak mohol náhodou zrušiť už
  // odpracovaný stav. Označenie ako vytlačené potvrdenie nepotrebuje.
  const [confirmingUncheck, setConfirmingUncheck] = useState(false);
  const confirmOverlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (confirmingUncheck) {
      confirmOverlayRef.current?.focus();
    }
  }, [confirmingUncheck]);

  async function handleToggle(next: boolean) {
    // Optimistický update — checkbox reaguje okamžite, bez čakania na server.
    setPrinted(next);
    setSaveError(null);

    try {
      const response = await fetch(`/api/orders/${orderNumber}/printed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: itemKey, printed: next }),
      });

      if (!response.ok) {
        throw new Error("Zápis zlyhal");
      }
    } catch {
      // Zápis zlyhal — vrátime checkbox do pôvodného stavu a ukážeme hlášku.
      setPrinted(!next);
      setSaveError("Nepodarilo sa uložiť stav. Skús to znova.");
    }
  }

  return (
    <div className={`design-card${printed ? " design-card--printed" : ""}`}>
      <div className="design-card-header">
        <div className="design-card-header-left">
          <span className="design-index">SKU: {sku}</span>
          {/* Checkbox hneď vedľa SKU pillu, nie na vlastnom riadku — šetrí miesto.
              Zostáva vždy plne viditeľný (mimo stlmeného .design-card-body nižšie),
              inak by sa po označení ťažšie hľadal na odznačenie. Dotyková plocha
              min. 44×44 cez padding na .printed-toggle. */}
          <label className="printed-toggle">
            <input
              type="checkbox"
              checked={printed}
              onChange={(event) => {
                const next = event.target.checked;
                if (!next) {
                  // Checkbox necháme (kontrolovaný komponent) v pôvodnom stave,
                  // kým používateľ potvrdí v dialógu nižšie.
                  setConfirmingUncheck(true);
                  return;
                }
                handleToggle(true);
              }}
            />
            <span>Vytlačené</span>
          </label>
        </div>
        <span className="design-id">Design ID: {design.designId}</span>
      </div>
      {/* Samostatný riadok POD hlavičkou, nie v nej — hlavička je na mobile na
          hranici šírky a jej zalamovanie podľa media query (SPEC.md §4.2) sa
          nesmie zmeniť. */}
      {sap && <SapZlRow sap={sap} />}
      {saveError && <p className="printed-toggle-error">{saveError}</p>}

      {confirmingUncheck && (
        <div
          ref={confirmOverlayRef}
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          onClick={() => setConfirmingUncheck(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setConfirmingUncheck(false);
          }}
        >
          <div
            className="confirm-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <p>Naozaj chceš označiť túto položku ako nevytlačenú?</p>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="confirm-button confirm-button--cancel"
                onClick={() => setConfirmingUncheck(false)}
              >
                Nie
              </button>
              <button
                type="button"
                className="confirm-button confirm-button--confirm"
                onClick={() => {
                  setConfirmingUncheck(false);
                  handleToggle(false);
                }}
              >
                Áno
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="design-card-body">
        {changedTextile ? (
          <div className="info-stack">
            <SapChangedTextile
              changedTextile={changedTextile}
              originalSku={lineItem?.sku ?? design.productSku}
              originalVariant={lineItem?.variantTitle ?? productName}
            />
          </div>
        ) : (
          <div className="info-stack">
            <div className="design-product-name">{productName}</div>
            {lineItem?.variantTitle && (
              <span className="variant-chip">{lineItem.variantTitle}</span>
            )}
            <div className="line-item-qty">Množstvo: {quantity} ks</div>

            {lineItem && (
              <div className="line-item-stock">
                <span>Sklad MERCHYOU: {lineItem.stockMerchyou ?? "—"}</span>
                <span>Sklad dodávateľa: {lineItem.stockSuppliers ?? "—"}</span>
              </div>
            )}
          </div>
        )}

        <div className="design-content">
          {previewImages.length > 0 ? (
            <div className="preview-grid">
              {previewImages.map((side, sideIndex) => (
                <ZoomableImage
                  key={side.previewUrl}
                  src={side.previewUrl}
                  alt={`${productName} – ${previewLabels[sideIndex]}`}
                  label={previewLabels[sideIndex]}
                />
              ))}
            </div>
          ) : (
            <p className="empty-state">
              Náhľad zatiaľ nie je pripravený (stav:{" "}
              {design.printFilesStatus ?? "neznámy"}).
            </p>
          )}

          {design.sides.length > 0 && (
            <div className="download-buttons">
              {design.sides.map((side, sideIndex) => {
                // Index, nie sideName — jedna strana môže mať viac plôch s rovnakým
                // názvom (viď lib/side-labels.ts a app/api/download/route.ts).
                const params = new URLSearchParams({
                  order: orderNumber,
                  itemIndex: String(index),
                  sideIndex: String(sideIndex),
                });

                return (
                  <div key={side.fileUrl} className="download-buttons-side">
                    <span className="download-buttons-label">
                      {downloadLabels[sideIndex]}
                    </span>
                    <a
                      className="download-button"
                      href={`/api/download?${params.toString()}&format=dtg`}
                    >
                      ⬇ DTG
                    </a>
                    <a
                      className="download-button"
                      href={`/api/download?${params.toString()}&format=dtf`}
                    >
                      ⬇ DTF (orezané)
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
