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
- **Download endpointy (`/api/download`):** DTG sa streamuje priamo (bez
  bufferovania), DTF sa orezáva cez `sharp` (potrebuje celý súbor v pamäti —
  na obrázok 4600×5800 px to je rádovo desiatky MB). Nastavené
  `export const maxDuration = 60`. Vercel Hobby plán (Fluid Compute) má
  defaultne aj maximálne 300 s na funkciu, čo je viac než dosť.
  Zvažovali sme presmerovanie DTG priamo na Zakeke CDN (úplne by obišlo
  našu funkciu, nulové riziko limitu veľkosti odpovede) — zamietnuté, lebo
  Zakeke CDN (Cloudflare R2) ignoruje `response-content-disposition`
  parameter, takže by sme prišli o čitateľný názov súboru podľa §4.3.
  DTG preto zostáva streamovaný cez našu funkciu.
- **Výkon:** server-side in-memory cache (`lib/cache.ts`, TTL ~3 min) na
  výsledky Zakeke Orders API a mockup preview dopytov (kľúč: číslo
  objednávky, resp. stránka `/v2/orders` pre zdieľanie medzi objednávkami).
  Homepage po zistení, ktoré objednávky majú potlač, spustí na pozadí
  (zámerne bez `await` — pozri komentár v `app/(app)/page.tsx`) prefetch
  detailu každej z nich, aby bol neskorší klik na detail rýchly z teplej
  cache. Detail objednávky používa React Suspense: hlavička (Shopify dáta)
  sa vykreslí hneď, sekcia dizajnov (Zakeke, pomalšia) sa strimuje s
  skeleton fallbackom, kým sa nedotiahne — overené, že Next.js skutočne
  posiela chunked odpoveď a nie hotovú stránku naraz.
- **Shopify autentifikácia:** appka je vytvorená cez Shopify Dev Dashboard,
  preto nemá trvalý Admin API token. Server si server-to-server vymení
  `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` za dočasný access token
  (Client Credentials Grant, pozri
  https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant).
  Token sa cachuje v pamäti servera a pred expiráciou automaticky obnovuje.
- **Úložisko:** žiadne (MVP je bezstavové — všetko sa číta live z API).
- **Obrázky:** knižnica `sharp` na serverovú úpravu PNG (DTF orez).
- **Prístup:** jednoduché prihlásenie jedným zdieľaným heslom (env variable
  `APP_PASSWORD`), session cookie. Bez užívateľských účtov.

### Environment variables (Vercel → Settings → Environment Variables)

```
SHOPIFY_STORE_DOMAIN     # merchyoueshop.myshopify.com
SHOPIFY_CLIENT_ID        # Dev Dashboard app — Client Credentials Grant
SHOPIFY_CLIENT_SECRET    # Dev Dashboard app — Client Credentials Grant
ZAKEKE_CLIENT_ID
ZAKEKE_CLIENT_SECRET     # S2S OAuth token flow podľa Zakeke docs
APP_PASSWORD             # heslo do appky
APP_BASE_URL             # verejná URL appky, napr. https://my-shop-production.vercel.app
                         # (bez lomítka na konci) — používa ju /api/admin/register-webhook
```

## 3. Zdroje dát a ich role

### 3.1 Shopify Admin API — „logistika"

Zdroj pre: zoznam unfulfilled objednávok, dátum vytvorenia, zákazník, tagy,
dopravca, line itemy (názov produktu, variant/veľkosť/farba, **SKU**, quantity),
skladové metafieldy.

- Objednávky: `status=open, fulfillment_status=unfulfilled` (GraphQL Admin API).
- **Tagy (zobrazovať v zozname aj detaile):**
  - `SAP processed` (porovnávať bez ohľadu na veľkosť písmen) — objednávka
    prešla do SAP. Ak tag chýba, objednávku vizuálne odlíšiť (sivý riadok +
    badge „čaká na SAP") — synchronizácia beží 15–30 min, dlhšie chýbanie =
    možná chyba prenosu.
  - `zasilkovna_selected` — dopravca Packeta (+ pobočka v order metafields /
    additional details `PickupPointName`).
  - `zasilkovna_unselected` — zákazník mal na výber Packetu, ale pobočku
    nevybral → dopravca GLS, v UI označiť ako „GLS (nevybraná pobočka
    Packeta)", aby bolo jasné, že ide o iný prípad než bežné GLS.
  - Žiadny `zasilkovna_*` tag — dopravca GLS (bez poznámky).
- **Deadline:** appka pri každom line iteme informatívne zobrazí aktuálne
  hodnoty metafieldov variantu `custom.stock_merchyou` a `custom.stock_suppliers`
  (sklad MERCHYOU / sklad dodávateľa). Samotný termín dodania sa počíta a
  ukladá presne raz — pri vzniku objednávky (webhook) alebo pri jednorazovom
  backfille — a v zozname/detaile sa už len číta, nikdy neprepočítava pri
  zobrazení (pozri §5).
- **Skladové metafieldy a Zakeke klon produktu:** Zakeke pri personalizácii
  vytvorí v Shopify klon objednaného produktu (Product type `zakeke-design`)
  s rovnakým SKU ako originál, ale bez reálnej skladovej zásoby. Skladové
  metafieldy (`custom.stock_merchyou`, `custom.stock_suppliers`) sa preto
  musia čítať z **originálneho produktu** (Product type iný než
  `zakeke-design`), dohľadaného podľa SKU — nie priamo z variantu line itemu.

### 3.2 Zakeke API — „dizajny a tlačové dáta"

Zdroj pre: zoznam dizajnov v objednávke, náhľady per strana, tlačové PNG per strana.

- **Autentifikácia:** `POST https://api.zakeke.com/token`, Basic auth
  (`client_id:client_secret`) + telo `grant_type=client_credentials&access_type=S2S`.
  Odpoveď má štandardné OAuth2 polia `access_token` + `expires_in` (dokumentácia
  na docs.zakeke.com nesprávne uvádza `access-token` s pomlčkou — v reálnej
  odpovedi je to `access_token`). Token sa cachuje a obnovuje rovnako ako
  Shopify token (§2).
- **Kľúčové zistenie z reálnych dát:** line item properties v Shopify
  (`_zakekeFileForSide*`) obsahujú len **nevyplnenú šablónu** — vypisujú
  všetky možné tlačové zóny produktovej šablóny (napr. FRONT, BACK, IMPRINT,
  LEFT/RIGHT SLEEVE), nie skutočne personalizované strany tejto objednávky.
  Hodnoty ako `designID`/`qty` sú v nich doslova neupravený placeholder text.
  Nedajú sa preto použiť na určenie, čo bolo naozaj potlačené.
- **Preto:** zoznam dizajnov objednávky čítať zo Zakeke **Orders API**
  `GET /v2/orders?pageSize=100&pageNumber=N` (vracia priamo pole objednávok,
  nie objekt s kľúčom `data`) — appka stránkuje (max. 3 stránky á 100,
  paralelne kvôli rýchlosti) a hľadá záznam, kde `orderNumber` sedí so
  Shopify číslom objednávky. Priame vyhľadanie podľa `code` (Zakeke interné
  ID) alebo `orderNumber` ako query parameter API nepodporuje.
- Každá položka (`items[]`) v odpovedi už obsahuje `productSku`, `productName`,
  `quantity` aj `printingFiles[] { type, url, sideName }` — **skutočne
  personalizované strany s reálnymi tlačovými PNG súbormi** (presné, použijú sa
  aj pri downloadoch v kroku 4). Objednávka bez personalizácie (čistý textil)
  buď v Zakeke vôbec nie je, alebo má všetky položky bez `printingFiles` — v
  zozname sa označí ako „Bez potlače" a v detaile ako „Iba textil bez potlače."
- Numerické Design ID (napr. 102539159, zobrazované v UI) nie je samostatné
  pole — je zakódované v názve súboru z `printingFiles[].url` (pozri §3.3).
- **Mockup na tričku per strana (FRONT/BACK/...):** oficiálne REST API
  (`GET /v3/designs/{designID}/{quantity}?modificationID=...`, dokumentované na
  docs.zakeke.com) vracia pole `previewFiles` konzistentne **prázdne** — overené
  opakovane na viacerých objednávkach a položkách, aj po tom, čo Zakeke support
  pridal `designModificationID` do Orders API presne podľa ich inštrukcií
  (nahlásené, čaká sa na vyjadrenie). Appka preto namiesto toho volá
  **nezdokumentované interné GraphQL API** `POST https://apollo.zakeke.com/graphql`
  (objavené reverzným inžinierstvom Network tabu v Zakeke merchant portáli —
  `orderDetailContentQuery`, pole `design.previews { sideName, url }`).
  Autentifikuje sa rovnakým S2S OAuth tokenom ako REST API (overené: identické
  JWT claims `clientID`/`UserID`/`accessType`). Implementácia je izolovaná v
  `lib/zakeke/internal-mockup-previews.ts` s jasným upozornením v kóde — ak
  Zakeke tento endpoint zmení/zablokuje, appka potichu spadne späť na zobrazenie
  `printingFiles` (reálny tlačový súbor bez mockupu na tričku), nie na chybu.
- Náhľady (mockup aj tlačové súbory) sa v appke načítavajú cez `/api/zakeke-image`
  (server-side proxy s allowlistom domény `*.zakeke.com`), nikdy priamo
  z prehliadača.
- Párovanie so Shopify line itemami: podľa SKU + quantity, každý Shopify
  line item sa použije nanajvýš raz (informatívne — detail objednávky
  primárne zobrazuje dizajny zo Zakeke, doplnené o variant/sklad zo Shopify,
  kde sa dá jednoznačne priradiť).

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
- Počet SKU **a** súčet kusov na potlač (napr. „2 SKU · 8 ks") — samotný počet
  SKU môže výrobu zmiasť, keďže jedno SKU môže mať quantity > 1. Ak objednávka
  nemá v Zakeke žiadnu personalizáciu (čistý textil), namiesto toho sa zobrazí
  „Bez potlače".
- Badge dopravcu: Packeta / GLS
- Badge „čaká na SAP" ak chýba tag `SAP processed`
- Triedenie: podľa dátumu vytvorenia, najstaršie hore. Filter/vyhľadávanie
  podľa čísla objednávky.

### 4.2 Detail objednávky

Hlavička: číslo, dátum, zákazník, dopravca (+ pobočka Packety),
tagy, poznámky z objednávky.

Potom **karta pre každý dizajn** (zo Zakeke):

- Náhľad(y) — obrázky per strana (mockup na tričku, ak sa podarilo načítať;
  fallback na reálny tlačový súbor), veľké, klikateľné na zväčšenie
- Design ID, **SKU textilu** (výrazne — spoločný identifikátor so SAP),
  názov produktu, variant (farba/veľkosť zo Shopify), **množstvo kusov**
- Hodnoty oboch skladov: `custom.stock_merchyou` (sklad MERCHYOU) a
  `custom.stock_suppliers` (sklad dodávateľa)
- Pre každú customized stranu (FRONT/BACK/…), na jednom riadku
  `{STRANA} ⬇ DTG ⬇ DTF (orezané)`:
  - tlačidlo **⬇ DTG** — originál PNG od Zakeke bez zmeny (zachovaný rozmer
    palety)
  - tlačidlo **⬇ DTF (orezané)** — PNG orezané na hranice grafiky
    (server-side `sharp`: trim podľa alfa kanála)
- Layout: mobile-first (náhľady hore, tlačidlá pod nimi); na desktope
  (od 720px) mriežka náhľadov vľavo a tlačidlá vpravo od nej v jednom riadku,
  aby sa nemuselo scrollovať. Overené aj pre 7 strán s najdlhšími názvami
  (napr. „LEFT SH. SLEEVE").
- Voliteľne (podľa miesta v UI): nenápadný link „Summary PDF (Zakeke)"

### 4.3 Pomenovanie súborov pri downloade

Zrozumiteľné pre výrobu, jednoznačné aj pri viacerých dizajnoch s rovnakým SKU
a stranou: `{objednávka}-D{poradie}-{SKU}-{STRANA}-{qty}ks-{DTG|DTF}.png`
napr. `1772-D3-278448-FRONT-1ks-DTF.png`. Formát ľahko upraviteľný na jednom
mieste v kóde (výroba ho ešte doladí).

## 5. Výpočet deadlinov

Termín dodania sa vyhodnocuje **presne raz** a natrvalo zapisuje ako order
metafield — appka ho pri zobrazení už nikdy neprepočítava (`custom.deadline_type`,
`custom.delivery_deadline`, namespace `custom`, appka má scope `write_orders`).

- **Klasifikácia typu deadlinu:** pre každý line item sa porovná
  `custom.stock_merchyou` **originálneho** produktu (nájdeného podľa SKU —
  nie zakeke-design klonu, viď §3.1) so `quantity`. Ak má položka dostatočný
  sklad (`stock_merchyou >= quantity`), je to 3-dňová položka, inak 12-dňová.
  Chýbajúci/needitovateľný sklad sa berie konzervatívne ako 12-dňový (radšej
  dlhší sľúbený termín, než omylom kratší).
- **Deadline objednávky:** dátum vytvorenia + 12 pracovných dní, ak má
  objednávka aspoň jednu 12-dňovú položku, inak + 3 pracovné dni.
- **Pracovné dni:** pondelok–piatok, mínus slovenské štátne sviatky — fixné
  dátumy (1.1., 6.1., 1.5., 8.5., 5.7., 29.8., 1.9., 15.9., 1.11., 17.11.,
  24.–26.12.) a Veľký piatok + Veľkonočný pondelok počítané algoritmicky
  (Meeus/Jones/Butcher). Implementácia: `lib/slovak-calendar.ts`, s unit
  testami (`lib/slovak-calendar.test.ts`, `npm test`).
- **Kedy sa počíta:**
  1. **Webhook** `orders/create` (`app/api/webhooks/orders-create/route.ts`) —
     overí HMAC podpis (`X-Shopify-Hmac-Sha256`, `SHOPIFY_CLIENT_SECRET`, nad
     surovým telom requestu), spočíta a zapíše oba metafieldy pri vzniku
     každej novej objednávky.
  2. **Backfill** (`app/api/admin/backfill-deadlines/route.ts`, chránené
     session cookie) — jednorazová/opakovateľná admin akcia, ktorá dopočíta
     deadline pre existujúce unfulfilled objednávky, ktorým metafield ešte
     chýba (napr. vznikli pred nasadením webhooku).
- **Registrácia webhooku:** cez Shopify Admin GraphQL API
  (`webhookSubscriptionCreate`/`Update`, appka už má funkčnú S2S autentifikáciu
  — netreba Shopify CLI ani Partner Dashboard), jednorazovo zavolaním
  `app/api/admin/register-webhook/route.ts` (chránené session cookie,
  idempotentné). `callbackUrl` sa skladá z env `APP_BASE_URL` (stabilná
  produkčná doména appky, nie deployment-špecifická URL s hashom).
- **Zobrazenie:** zoznam objednávok má stĺpce „Vytvorená" a „Deadline"
  (čítané priamo z metafieldu; chýbajúci metafield → „—"). Objednávky po
  termíne majú jemné červené pozadie a červený dátum. Vedľa nadpisu je
  aktuálny deň a dátum po slovensky (`lib/format.ts`).
  Zoznam (mobile karty aj desktop tabuľka) a detail objednávky majú zámerne
  **odlišný vizuálny štýl** pre tie isté dva dátumy: zoznam kompaktný
  (dátumy v rohu karty/stĺpce, jeden riadok na dátum, na rýchle skenovanie
  veľkého počtu objednávok), detail výraznejší „popisok nad hodnotou" blok
  (viac priestoru, dôraz na prehľadnosť pri jednej konkrétnej objednávke).
  Rovnaký komponent na oboch miestach pôsobil ako neúplná kópia, nie ako
  dve zámerne odlíšené úrovne informácie.

## 6. Mimo rozsahu MVP (verzia 1.1+)

- Stavy zákaziek označované výrobou („v tlači" / „vytlačené", per side) —
  vyžaduje malé úložisko (Vercel KV), pridá sa vo v1.1.
- Napojenie na SAP (číslo zákazkového listu). Medzikrok: ak sa číslo objaví
  ako tag/metafield/poznámka v Shopify, appka ho automaticky zobrazí.
- Druhý e-shop merchshop.com (bez Zakeke) — mimo rozsahu.
- Push notifikácie, užívateľské účty, história.
- Triedenie zoznamu podľa deadlinu (namiesto dátumu vytvorenia) a vizuálne
  odlíšenie 3-dňových položiek priamo v detaile objednávky.

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
7. Pri vzniku novej objednávky appka automaticky zapíše typ deadlinu a termín
   dodania ako order metafield (§5); zoznam objednávok zobrazuje „Vytvorená"
   a „Deadline" čítané z tohto metafieldu, s červeným zvýraznením po termíne,
   bez prepočtu pri zobrazení.

## 8. Postup vývoja (odporúčané poradie pre Claude Code)

1. Kostra projektu + prihlásenie heslom + layout (mock dáta).
2. Shopify integrácia: zoznam objednávok, tagy, skladové metafieldy.
3. Zakeke integrácia: OAuth, dizajny objednávky, náhľady.
4. Download endpointy: DTG proxy + DTF trim cez sharp.
   - 4b. Výkon (cache, prefetch, skeleton) a branding (§9).
5. Doladenie UI podľa spätnej väzby výroby.
6. Presné deadliny cez webhook `orders/create` + backfill + UI stĺpce (§5).

## 9. Branding

- **Fonty:** Metropolis, self-hosted cez `@font-face` (`public/brand/*.woff2`,
  žiadny externý CDN/Google Fonts). Len dva rezy — Light (300) ako predvolený
  pre bežný text, Bold (700) na nadpisy (`h1`/`h2`/`h3`) a zvýraznené prvky
  (badge, tlačidlá, čísla objednávok). Všetky ostatné `font-weight` hodnoty
  v CSS sú preto zjednotené na 300/700 — medzihodnoty (napr. 600) by prehliadač
  bez zodpovedajúceho rezu len falšoval (font synthesis), čo pri Metropolise
  vyzeralo nekonzistentne.
- **Farby:** primárna tmavá `#231f20` (text, pozadie hlavičky appky),
  akcentová tyrkysová `#8ec1c3` (primárne tlačidlá, aktívne/hover stavy,
  badge dopravcu Packeta — plná tyrkysová plocha s tmavým textom, nie
  vlastný odtieň). Text na tyrkysovom pozadí je tmavý (`#231f20`), nie biely
  — biely má na tejto farbe slabý kontrast. **Zámerne žiadne ďalšie farebné
  kombinácie** (napr. vlastný "zelenomodrý" odtieň pre badge dopravcu) — iba
  čierna/biela/odtiene šedej/tyrkysová, s výnimkou červenej na badge „čaká
  na SAP" (zámerne negatívna/varovná informácia). Zvyšok (pozadie, karty,
  okraje) ostáva neutrálny svetlý, bez zmeny.
- **Logo:** `public/brand/icon_MY.svg` — v hlavičke appky (vedľa názvu),
  na login stránke (nad nadpisom) a ako favicon (`app/layout.tsx` →
  `metadata.icons`). Middleware musí mať `/brand` vo výnimke z auth
  presmerovania (logo/fonty musia byť dostupné aj na neprihlásenej
  `/login` stránke) — inak sa tvária ako rozbitý obrázok/font, keďže
  request na ne presmeruje na `/login` namiesto vrátenia súboru.
- **Badge nesmú mať `white-space: nowrap`** — pobočka Packeta môže byť
  dlhá (napr. „Z-BOX Liptovský Mikuláš, Hrušková 514/9 (COOP Jednota)"),
  pri `nowrap` preteká cez okraj karty na mobile. Musia sa vedieť zalomiť
  (`white-space: normal` + `min-width: 0`, keďže ide o flex item).
- **Variant produktu (farba/veľkosť) sa zobrazuje ako samostatný chip**
  (`.variant-chip`), nie pripojený k názvu produktu bodkou — pri dlhších
  názvoch produktu bola bodka prakticky neviditeľná. Info blok (SKU, názov,
  variant, množstvo, sklady) používa spoločný `.info-stack` wrapper s
  jednotným rozostupom (flex `gap`) namiesto ručne ladeného `margin-top`
  na každom riadku.
