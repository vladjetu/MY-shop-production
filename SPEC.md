# SPEC — Výrobná aplikácia pre eshop MERCHYOU.shop (interný názov: „MY shop production")

## 1. Cieľ

Webová aplikácia pre tím výroby (tlač textilu). Nahrádza dnešný pomalý proces
(Shopify admin → Zakeke portál → download veľkého ZIPu → hľadanie súborov).

Výroba potrebuje:

1. Rýchly zoznam nevybavených (unfulfilled) objednávok.
2. Detail objednávky s náhľadmi všetkých dizajnov priamo na obrazovke.
3. Download jednotlivých tlačových súborov po jednom (per dizajn, per strana),
   vo variante pre DTG aj DTF — bez sťahovania celého ZIPu.

**Mobile-first.** Primárne použitie na telefóne/tablete pri stroji, plne
responzívne aj pre desktop. Jazyk UI: slovenčina.

## 2. Architektúra a tech stack

- **Hosting:** Vercel (free tier). Frontend + serverless funkcie v jednom repe.
- **Frontend:** jednoduchá SPA alebo Next.js (odporúčané Next.js App Router —
  Vercel native). Bez zbytočných knižníc, čistý svetlý dizajn.
- **Backend:** Vercel serverless funkcie (Node.js). VŠETKY volania na Shopify
  a Zakeke idú výhradne cez ne. API kľúče nikdy nesmú byť vo frontende.
- **Úložisko:** žiadne (MVP je bezstavové — všetko sa číta live z API).
- **Obrázky:** knižnica `sharp` na serverovú úpravu PNG (DTF orez).
- **Prístup:** jednoduché prihlásenie jedným zdieľaným heslom (env variable
  `APP_PASSWORD`), session cookie. Bez užívateľských účtov.

### Environment variables (Vercel → Settings → Environment Variables)

```
SHOPIFY_STORE_DOMAIN     # merchyoueshop.myshopify.com
SHOPIFY_ADMIN_TOKEN      # Admin API access token (custom app, read_orders, read_products)
ZAKEKE_CLIENT_ID
ZAKEKE_CLIENT_SECRET     # S2S OAuth token flow podľa Zakeke docs
APP_PASSWORD             # heslo do appky
```

## 3. Zdroje dát a ich role

### 3.1 Shopify Admin API — „logistika"

Zdroj pre: zoznam unfulfilled objednávok, dátum vytvorenia, zákazník, tagy,
dopravca, line itemy (názov produktu, variant/veľkosť/farba, **SKU**, quantity),
skladové metafieldy.

- Objednávky: `status=open, fulfillment_status=unfulfilled` (GraphQL Admin API).
- **Tagy (zobrazovať v zozname aj detaile):**
  - `SAP Processed` — objednávka prešla do SAP. Ak tag chýba, objednávku
    vizuálne odlíšiť (sivý riadok + badge „čaká na SAP") — synchronizácia beží
    15–30 min, dlhšie chýbanie = možná chyba prenosu.
  - `zasilkovna_selected` / `zasilkovna_unselected` — dopravca Zásilkovňa
    (+ pobočka v order metafields / additional details `PickupPointName`).
  - Žiadny `zasilkovna_*` tag — dopravca GLS.
- **Deadline:** v MVP sa nepočíta. Appka pri každom line iteme iba informatívne
  zobrazí aktuálne hodnoty metafieldov variantu `custom.stock_merchyou` a
  `custom.stock_suppliers` (sklad MERCHYOU / sklad dodávateľa).

### 3.2 Zakeke API — „dizajny a tlačové dáta"

Zdroj pre: zoznam dizajnov v objednávke, náhľady per strana, tlačové PNG per strana.

- Autentifikácia: S2S OAuth token (client credentials).
- **Kľúčové zistenie z reálnych dát:** line item properties v Shopify
  (`_zakekeFileForSide*`) obsahujú len šablónu názvov súborov a kód položky —
  pri dvoch rovnakých produktoch v objednávke sú IDENTICKÉ, nedajú sa použiť
  na spoľahlivé párovanie dizajn ↔ riadok objednávky.
- **Preto:** zoznam dizajnov objednávky čítať priamo zo Zakeke **Orders API**
  podľa čísla objednávky (napr. 1772). Zakeke vracia pre každý dizajn:
  Design ID (napr. 102539159), Design Doc ID, Product SKU, Quantity,
  Customized sides (FRONT/BACK/…). Presný endpoint overiť v
  https://docs.zakeke.com (Orders API / Designs API).
- Náhľady per strana: Designs API `GET /v3/designs/{designID}/{quantity}` →
  `previewFiles[] { url, sideName }`.
- Tlačové súbory per strana: Designs API outputfiles endpointy (PNG per side);
  ZIP endpoint `GET /v1/designs/{designID}/outputfiles/zip` len ako fallback.
- Párovanie so Shopify line itemami: podľa SKU + quantity (informatívne —
  detail objednávky primárne zobrazuje dizajny zo Zakeke, doplnené o veľkosť
  /variant zo Shopify, kde sa to dá jednoznačne priradiť).

### 3.3 Overená štruktúra tlačových súborov (z reálneho ZIPu)

- Názov: `1772_15005692690757_FRONT_10003417_1_000102539159_1__White.png`
  = objednávka _ kódPoložky _ STRANA _ printArea _ x _ 000+DesignID _ qty \_ \_ farba
- PNG: RGBA s **transparentným pozadím**, 300 DPI, rozmer = celá tlačová paleta
  (napr. 4606×5787 px). Alfa kanál je spoľahlivý → automatický orez funguje.
- Priečinok `SourceFileImages` a `Summary_*.pdf` zo ZIPu výroba nepoužíva.

## 4. Obrazovky

### 4.1 Zoznam objednávok (homepage)

Mobile-first zoznam/karty, na desktope tabuľka. Pre každú objednávku:

- Číslo objednávky (#1772), dátum vytvorenia
- Zákazník (meno)
- Počet položiek / dizajnov
- Badge dopravcu: Zásilkovňa / GLS
- Badge „čaká na SAP" ak chýba tag `SAP Processed`
- Triedenie: podľa dátumu vytvorenia, najstaršie hore. Filter/vyhľadávanie
  podľa čísla objednávky.

### 4.2 Detail objednávky

Hlavička: číslo, dátum, zákazník, dopravca (+ pobočka Zásilkovne),
tagy, poznámky z objednávky.

Potom **karta pre každý dizajn** (zo Zakeke):

- Náhľad(y) — obrázky per strana, veľké, klikateľné na zväčšenie
- Design ID, **SKU textilu** (výrazne — spoločný identifikátor so SAP),
  názov produktu, variant (farba/veľkosť zo Shopify), **množstvo kusov**
- Hodnoty oboch skladov: `custom.stock_merchyou` (sklad MERCHYOU) a
  `custom.stock_suppliers` (sklad dodávateľa)
- Pre každú customized stranu (FRONT/BACK/…):
  - tlačidlo **⬇ DTG** — originál PNG od Zakeke bez zmeny (zachovaný rozmer
    palety)
  - tlačidlo **⬇ DTF (orezané)** — PNG orezané na hranice grafiky
    (server-side `sharp`: trim podľa alfa kanála)
- Voliteľne (podľa miesta v UI): nenápadný link „Summary PDF (Zakeke)"

### 4.3 Pomenovanie súborov pri downloade

Zrozumiteľné pre výrobu, jednoznačné aj pri viacerých dizajnoch s rovnakým SKU
a stranou: `{objednávka}-D{poradie}-{SKU}-{STRANA}-{qty}ks-{DTG|DTF}.png`
napr. `1772-D3-278448-FRONT-1ks-DTF.png`. Formát ľahko upraviteľný na jednom
mieste v kóde (výroba ho ešte doladí).

## 5. Výpočet deadlinov

Výpočet deadlinov je presunutý do verzie 1.1 (pozri §6). V MVP sa deadliny
nepočítajú ani nezobrazujú.

## 6. Mimo rozsahu MVP (verzia 1.1+)

- Stavy zákaziek označované výrobou („v tlači" / „vytlačené", per side) —
  vyžaduje malé úložisko (Vercel KV), pridá sa vo v1.1.
- Napojenie na SAP (číslo zákazkového listu). Medzikrok: ak sa číslo objaví
  ako tag/metafield/poznámka v Shopify, appka ho automaticky zobrazí.
- Druhý e-shop merchshop.com (bez Zakeke) — mimo rozsahu.
- Push notifikácie, užívateľské účty, história.
- Deadliny (v1.1): pri vzniku objednávky (Shopify webhook `orders/create`)
  appka vyhodnotí typ deadlinu — ak `custom.stock_merchyou` >= quantity line
  itemu, tak 3 pracovné dni, inak 12 — a zapíše ho natrvalo ako order
  metafield. Deadline sa počíta v pracovných dňoch podľa slovenského
  kalendára (fixné sviatky + Veľká noc algoritmicky). Zoznam a detail potom
  zobrazia deadline s farebnou indikáciou, 3-dňové položky zvýraznené,
  triedenie podľa deadlinu.

## 7. Akceptačné kritériá MVP

1. Po prihlásení heslom vidím zoznam všetkých unfulfilled objednávok
   z merchyou.shop, zoradený podľa dátumu vytvorenia, s tagmi SAP/dopravca.
2. Zoznam je triedený podľa dátumu vytvorenia a pri položkách v detaile
   vidím aktuálne skladové hodnoty stock_merchyou a stock_suppliers.
3. V detaile objednávky #1772 vidím 4 dizajny (102539156–159), každý so
   správnym SKU, množstvom, náhľadmi FRONT aj BACK.
4. Viem stiahnuť samostatne FRONT dizajnu „07" ako DTG (plná paleta
   4606×5787) aj ako DTF (orezané na grafiku, transparentné pozadie
   zachované) so zrozumiteľným názvom súboru.
5. Appka je pohodlne použiteľná na mobile (šírka ~390 px) aj na desktope.
6. Žiadny API kľúč sa nenachádza vo frontend kóde ani v Git repozitári
   (.env v .gitignore, na Verceli env variables).

## 8. Postup vývoja (odporúčané poradie pre Claude Code)

1. Kostra projektu + prihlásenie heslom + layout (mock dáta).
2. Shopify integrácia: zoznam objednávok, tagy, skladové metafieldy.
3. Zakeke integrácia: OAuth, dizajny objednávky, náhľady.
4. Download endpointy: DTG proxy + DTF trim cez sharp.
5. Doladenie UI podľa spätnej väzby výroby.
