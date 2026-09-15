/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Appka je celá dynamická (force-dynamic, žiadny cache: no-store na Shopify aj
    // Zakeke requestoch) a dáta sa musia vždy čítať čerstvé — vrátane stavu "Vytlačené"
    // (v1.2), ktorý musí byť rovnaký pre všetkých na všetkých zariadeniach. Bez tohto
    // nastavenia Next.js klientský Router Cache dokáže pri návrate na stránku (Späť v
    // prehliadači alebo Link) až 30 sekúnd ukazovať starý snapshot stránky, aj keď
    // server dáta nikdy necachuje.
    staleTimes: {
      dynamic: 0,
    },
  },
};

module.exports = nextConfig;
