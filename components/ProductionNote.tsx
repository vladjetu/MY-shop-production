"use client";

import { useEffect, useRef, useState } from "react";

// Debounce: uloží krátko po tom, čo používateľ prestane písať. 1,5s je
// kompromis — kratšie by appku zbytočne zaťažovalo zápismi na každé slovo
// (aj riziko rate limitu na Shopify Admin API), dlhšie zväčšuje okno, v ktorom
// môže ostať rozpísaný text neuložený (napr. pri náhlom zatvorení stránky —
// pre to je tu navyše záchranná sieť cez blur/visibilitychange/unmount nižšie).
const SAVE_DEBOUNCE_MS = 1500;

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function ProductionNote({
  orderNumber,
  initialNote,
}: {
  orderNumber: string;
  initialNote: string;
}) {
  const [text, setText] = useState(initialNote);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [conflictNote, setConflictNote] = useState<string | null>(null);

  // baseline = posledná hodnota, o ktorej vieme, že je zapísaná na serveri —
  // slúži na rozpoznanie súbežnej editácie (viď handleSave nižšie) aj na to,
  // aby sme neposielali zápis, keď sa vlastne nič nezmenilo.
  const baselineRef = useRef(initialNote);
  const textRef = useRef(initialNote);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textRef.current = text;
    resizeTextarea();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    // Bez vnútorného scrollovania a bez "skákania" — výška sa prepočíta na
    // presný obsah pri každej zmene (aj hneď pri načítaní existujúcej poznámky).
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    resizeTextarea();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(noteToSave: string, force = false) {
    if (!force && noteToSave === baselineRef.current) {
      // Nič sa nezmenilo od posledného uloženia — netreba zbytočný request.
      return;
    }

    setStatus("saving");

    try {
      const response = await fetch(`/api/orders/${orderNumber}/production-note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: noteToSave,
          expectedBaseline: force ? undefined : baselineRef.current,
          force,
        }),
      });

      if (response.status === 409) {
        const data = (await response.json().catch(() => null)) as { currentNote?: string } | null;
        setConflictNote(data?.currentNote ?? "");
        setStatus("idle");
        return;
      }

      if (!response.ok) {
        throw new Error("Zápis zlyhal");
      }

      baselineRef.current = noteToSave;
      setConflictNote(null);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  function scheduleSave(next: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      handleSave(next);
    }, SAVE_DEBOUNCE_MS);
  }

  function flushPendingSave() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    handleSave(textRef.current);
  }

  // Tab/aplikácia na pozadí (aj mobil — prepnutie appky, zamknutie obrazovky)
  // je spoľahlivejší signál "používateľ odchádza" než beforeunload/unload,
  // ktoré sa na mobilných prehliadačoch často vôbec nespustia. sendBeacon
  // funguje aj vtedy, keď sa stránka práve zatvára/uspáva — bežný fetch by
  // prehliadač mohol prerušiť skôr, než request odíde.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== "hidden") return;
      if (textRef.current === baselineRef.current) return;

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      const payload = JSON.stringify({
        note: textRef.current,
        expectedBaseline: baselineRef.current,
      });
      navigator.sendBeacon?.(
        `/api/orders/${orderNumber}/production-note`,
        new Blob([payload], { type: "application/json" })
      );
      // sendBeacon je "fire-and-forget" (žiadna odpoveď) — konflikt sa tu
      // nedá rozpoznať, len pri ďalšom uložení z tejto alebo inej stránky.
      baselineRef.current = textRef.current;
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber]);

  // Odchod zo stránky cez klientskú navigáciu (napr. "Späť na zoznam") nespustí
  // beforeunload ani visibilitychange — dokument sa nezatvára, len sa odpojí
  // tento komponent. Zápis pri odpojení preto ošetríme samostatne.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (textRef.current !== baselineRef.current) {
        handleSave(textRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function statusLabel(): string | null {
    if (status === "saving") return "Ukladá sa…";
    if (status === "saved") return "Uložené";
    if (status === "error") return "Nepodarilo sa uložiť poznámku. Skús to znova.";
    return null;
  }

  return (
    <div className="production-note">
      <label className="production-note-label" htmlFor="production-note-textarea">
        Poznámka výroba
      </label>
      <textarea
        id="production-note-textarea"
        ref={textareaRef}
        className="production-note-textarea"
        rows={2}
        placeholder="Poznámka pre výrobu (napr. stav rozpracovanosti, upozornenie)…"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setStatus("idle");
          scheduleSave(event.target.value);
        }}
        onBlur={flushPendingSave}
      />

      <div className="production-note-status">
        {status === "error" ? (
          <span className="production-note-status--error">
            {statusLabel()}{" "}
            <button type="button" className="production-note-retry" onClick={flushPendingSave}>
              Skúsiť znova
            </button>
          </span>
        ) : (
          statusLabel() && <span className="production-note-status--ok">{statusLabel()}</span>
        )}
      </div>

      {conflictNote !== null && (
        <div className="production-note-conflict">
          <p>
            Poznámka bola medzitým zmenená inde (pravdepodobne iným zariadením). Tvoje rozpísané
            zmeny sa neuložili.
          </p>
          <p className="production-note-conflict-value">
            Aktuálna verzia na serveri: {conflictNote.trim().length > 0 ? `„${conflictNote}"` : "(prázdna)"}
          </p>
          <div className="production-note-conflict-actions">
            <button
              type="button"
              className="confirm-button confirm-button--cancel"
              onClick={() => {
                setText(conflictNote);
                baselineRef.current = conflictNote;
                setConflictNote(null);
              }}
            >
              Načítať aktuálnu verziu
            </button>
            <button
              type="button"
              className="confirm-button confirm-button--confirm"
              onClick={() => {
                setConflictNote(null);
                handleSave(textRef.current, true);
              }}
            >
              Použiť moju verziu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
