"use client";

import { useState } from "react";

export function ZoomableImage({
  src,
  alt,
  label,
}: {
  src: string;
  alt: string;
  label?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" className="preview-thumb" onClick={() => setIsOpen(true)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" />
        {label && <span className="preview-thumb-label">{label}</span>}
      </button>

      {isOpen && (
        <div
          className="preview-overlay"
          role="button"
          tabIndex={0}
          onClick={() => setIsOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Enter") setIsOpen(false);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="preview-overlay-img" />
        </div>
      )}
    </>
  );
}
