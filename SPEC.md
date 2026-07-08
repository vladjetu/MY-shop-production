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
- **Deadline:** v MVP sa nepočíta. Appka pri každom line iteme iba informatívne
  zobrazí aktuálne hodnoty metafieldov variantu `custom.stock_merchyou` a
  `custom.stock_suppliers` (sklad MERCHYOU / sklad dodávateľa).
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
