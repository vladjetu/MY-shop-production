# SAP-INTEGRATION — napojenie MY shop production na SAP Business One

> Zdroj pravdy pre všetko, čo súvisí so SAP. SPEC.md naň odkazuje (§3.4).
> Pri zmene správania SAP integrácie aktualizuj **tento súbor aj SPEC.md**.
> Stav: návrh v1, overené testami 21.–22. 10. 2026 (všetky polia v §5
> potvrdené reálnymi dátami, okrem prevádzky agenta v §12).

## 1. Cieľ a rozsah v1

Výroba pracuje vo veľkej miere s údajmi zo SAP. Tok Shopify → SAP je
jednosmerný: keď support dodatočne mení objednávku (veľkosť, produkt, dopravu,
adresu), robí to **len v SAP**. Appka preto musí ukazovať údaje zo SAP tam,
kde je SAP zdrojom pravdy.

**V1 zobrazí:**
- v zozname objednávok stĺpec **ZL** (posledné 4 číslice SAP zákaziek),
- dopravcu podľa SAP (zoznam aj detail),
- pri každom dizajne v detaile číslo SAP zákazky (`ZL: 212604819`),
- pri dizajne, ktorého textil support zmenil v SAP, aktuálny textil zo SAP
  a „Zmenené v SAP {dátum čas} · {kto}“ (z histórie zmien SAP),
- pri každom ZL v detaile **stav zákazky zo SAP** (napr. „Na ceste“) a čas
  poslednej synchronizácie so SAP (zvýraznený, ak sú dáta neaktuálne).

**Mimo v1 (neskôr):** dodacia adresa zo SAP, priorita v UI, ručné
priradenie dizajnu k ZL, reklamácie, automatizácia dodávok (§13),
merchshop.com (mimo rozsahu projektu).

## 2. Prostredie SAP

| Položka | Hodnota |
|---|---|
| SAP | Business One 10.0 FP 2208 (verzia DI API `1000200`) |
| Databáza | MS SQL 2019, server `C002SRAZSAPDB01`, DB `Merchyou_prod` |
| Prístup | Windows App → Azure Virtual Desktop, session host `C002AVDSAP-0` |
| DI API | `C:\Program Files\SAP\SAP Business One DI API` (64-bit), COM `SAPbobsCOM.Company`, `DbServerType = 15` (MSSQL 2019) |
| SAP user pre čítanie | Vladov SAP user (`usr9`) |
| Service Layer | z AVD nedostupný (porty 50000/50001/40000 → timeout). S partnerom sa nerieši. |
| Odchádzajúci internet z AVD | funguje (HTTPS POST cez `Invoke-RestMethod` overený, nutné TLS 1.2) |

## 3. Architektúra — „pull agent“

```
[AVD] PowerShell agent ──DI API──> SAP DB (len SELECT)
        │
        └──HTTPS POST (JSON, secret v hlavičke)──> [Vercel] /api/sap-sync
                                                        │
                                                        └──> Upstash Redis (snapshot)
[Appka] zoznam / detail ──číta──> snapshot zo Upstash (nikdy nie priamo SAP)
```

- Komunikácia je **jednosmerná**: AVD → Vercel. Agent od Vercelu nič neprijíma
  a nevykonáva žiadne príkazy zvonka.
- Agent posiela pri každom behu **kompletný aktuálny zoznam** otvorených
  e-shop zákaziek (snapshot). Server snapshot celý prepíše — čo v SAP už nie je
  otvorené, z appky samo zmizne. Žiadna história sa neukladá.
- Agent beží len na AVD → **dáta sú aktuálne len počas Vladovej AVD relácie**.
  Appka musí ukazovať vek dát (§10.4).

## 4. Overené fakty (testy na AVD)

1. DI API `Connect()` funguje bez nastavenia licenčného servera, aj pri
   súčasne otvorenom SAP klientovi s tým istým userom.
2. Kľúč e-shop objednávky je `ORDR.NumAtCard` („Ref.čís.odberateľa“), formát
   `merchyou.shop:#2048` = `{e-shop}:{Shopify order.name}`.
3. Jedna Shopify objednávka → 0..N zákaziek. Príklad `#2045`: 5 zákaziek
   (4 s dizajnom + 1 čistý textil).
4. `RDR1.ItemCode` = Shopify SKU (pokiaľ support nič nemenil). Riadky `S…` sú
   servisné položky (`S000001` Packeta pick-up point, `S000003` Potlač textilu
   - digitál), nie produkty.
5. Ručné zmeny supportu sa robia len v SAP — príklad `#2045`: Shopify L, SAP M
   (`752002` → `752001`, `G000822` → `G000821`). Support môže vymeniť aj za
   úplne iný produkt.
6. `U_SFT_EXTERNALID` je prázdne — Shopify ID v SAP nie je, kľúčom zostáva
   `NumAtCard`.
7. `DocStatus` (Otvorené/Uzavreté) ≠ stav výroby. Zákazka `#2048` má
   `DocStatus = O`, ale status zákazky „Odoslané/Odovzdané“.
8. Riadky zákazky nemajú UDF s väzbou na konkrétnu Shopify položku.
9. `U_SFT_DOCTYPE` je kód: `5` = On demand (dizajn), `3` = Predaj textilu
   (overené na ZL 212604830 = čistý textil). Iné kódy sa pri e-shope zatiaľ
   nevyskytli; číselník nie je v `UFD1`.
10. Pri zmene dopravy supportom **zostávajú staré údaje o pobočke**
    (`#2040`: Osobný odber, ale `U_PICKUPNAME` = Z-BOX). Pobočku preto
    zobrazovať **len** pri `TrnspCode = 11`.
11. Objem (22. 10. 2026): ~60 otvorených e-shop ZL (z toho 18 so statusom 50,
    1 reklamácia). Snapshot má rádovo desiatky kB.
12. Výroba triedi textil podľa SAP (posiela sa do VA); z appky používa len
    náhľady a tlačové dáta.
13. **História zmien (Change log) je pre zákazky zapnutá** (`ADOC`/`ADO1`,
    `ObjType = '17'`). Overené na `#2045`:
    - Log obsahuje **predošlé verzie**; aktuálna verzia je len v `ORDR`/`RDR1`.
    - Verzia 1 = zákazka tak, ako ju vytvorila integrácia (user `B1i`) =
      pôvodná Shopify objednávka.
    - ZL 52017: log v1–v2 = `752002` (L), aktuálne `752001` (M), `ORDR`
      UpdateDate 19. 10. 2026, UpdateTS `122519`, Vladimír Horvát →
      zmena 19. 10. 2026 12:25:19.
    - ZL 52021: log v1–v3 = `G000822` (L), v4 = `G000821` (M) s pečiatkou
      19. 10. 2026 12:31:00 Vladimír Horvát; aktuálna verzia (M) s pečiatkou
      13:16:29 `B1i` — integrácia zákazku neskôr upravila bez zmeny textilu.
      Čas zmeny textilu je preto pečiatka **prvej** verzie s aktuálnym
      textilom, nie posledná úprava.
    - `UpdateTS` je číslo HHMMSS (`74613` = 07:46:13), lokálny čas SAP servera
      (Europe/Bratislava). Používateľ úpravy = `UserSign2` → `OUSR.U_NAME`.
14. Appka nemá vlastnú databázu (stav výroby ukladá do Shopify metafieldov,
    SPEC §2). Upstash Redis pribúda **len** pre SAP snapshot.
15. Stav „Na ceste“ (21) neznamená, že textil fyzicky ide k nám — len že
    objednávka textilu odišla dodávateľovi (textil môže byť u dodávateľa ešte
    blokovaný). Čas „odkedy je v stave“ preto výrobe nepomáha a nepoužíva sa.
16. Textilové polia na e-shop ZL (23. 10. 2026, 17 ZL so stavom 21/22) nenesú
    užitočnú informáciu: `U_SFT_POTEXTIL = Y`, `U_ENF_COVERED = Y`,
    `U_ENF_PARTIALO = N` všade, `U_SFT_PORNUM = 0`, `U_SFT_TEXTILDATE`
    a `U_EIF_DATEGRFUS` prázdne. Väzba ZL → objednávka dodávateľovi (`OPOR`)
    sa nenašla ani cez `POR1.BaseType = 17`, ani cez `U_SFT_PORNUM`. Ďalší
    prieskum v §13.

## 5. Dátový model SAP (čo čítame)

### 5.1 Hlavička zákazky — `ORDR`

| SQL pole | V SAP UI | Použitie |
|---|---|---|
| `DocEntry` | — | interné ID (stabilný kľúč) |
| `DocNum` | Čís. (napr. 212604819) | číslo ZL zobrazované v appke |
| `NumAtCard` | Ref.čís.odberateľa | kľúč na Shopify objednávku |
| `DocStatus` | Status | filter: len `O` |
| `CANCELED` | — | filter: len `N` |
| `U_SFT_DOCTYPE` | Typ dokumentu | kód: `5` On demand (dizajn), `3` Predaj textilu |
| `U_SFT_SPECIAL` | Špeciálny typ | `-` žiadny, `REKLAM` reklamácia (ďalej DAR, PROMO, SKLAD, SPONZOR, TEST) |
| `U_SFT_STATUS` | Status zákazky | číselník §5.3 — zdroj pravdy pre stav |
| `U_SFT_PRIORITY` | Priorita | `H` Vysoká, `S` Štandardná |
| `U_SFT_NOPRINT` | Zákazka bez potlače | `Y` = čistý textil |
| `TrnspCode` → `OSHP.TrnspName` | Logistika → Druh expedície | dopravca podľa SAP (číselník §5.3) |
| `U_PICKUPID`, `U_PICKUPNAME` | — | výdajné miesto Packeta — platné len pri `TrnspCode = 11` |
| `Address2` | Logistika → Dodacia adresa | v1 sa neposiela (§1); riadky oddelené CR/LF |
| `U_SFT_TRACKNO`, `U_SFT_SHIPDATE` | Tracking, Dátum odoslania | v1 sa neposiela; `30.12.1899` = prázdne |
| `DocDueDate`, `U_DocDDate` | Dátum dodávky | **nepoužívať** — deadline počíta appka (SPEC §5) |

### 5.2 Riadky zákazky — `RDR1`

`ItemCode` (SKU), `Dscription` (popis, napr. „STTW259, Natural Raw, M“),
`Quantity`, `LineNum`. Riadky s `ItemCode` začínajúcim na `S` sa vynechávajú.

### 5.2a História zmien — `ADOC` (hlavičky), `ADO1` (riadky)

Filter `ObjType = '17'` (zákazka odberateľa). Kľúč verzie: `DocEntry` +
`LogInstanc` (1, 2, …). Čítame: `ADOC.UpdateDate`, `ADOC.UpdateTS`,
`ADOC.UserSign2` → `OUSR.U_NAME`; `ADO1.LineNum`, `ItemCode`, `Dscription`,
`Quantity` (bez `S…`). Aktuálna verzia: `ORDR.UpdateDate`, `ORDR.UpdateTS`,
`ORDR.UserSign2` + riadky `RDR1`.

### 5.3 Číselníky (z `UFD1`)

**Status zákazky (`U_SFT_STATUS`):** 10 Draft · 11 Vytvoriť zálohu ·
12 Vystavená záloha · 15 Čaká na odsúhlasenie klientom · 20 Objednať textil ·
21 Na ceste · 22 Čiastočne na sklade · 23 Na sklade · 30 Zaplánovaná ·
40 Vo výrobe · 50 Odoslané/Odovzdané · 60 Outsourcing · 61 Ukončená výroba ·
62 Na expedíciu · 63 Nedostupný textil · 70 Prerušená výroba/Prestoj ·
71 Čiastočne na expedíciu · 72 Čiastočne odoslané

**Priorita (`U_SFT_PRIORITY`):** H Vysoká · S Štandardná

**Typ dokumentu (`U_SFT_DOCTYPE`):** 5 On demand · 3 Predaj textilu

**Druh expedície (`OSHP`):** 1 Osobný odber · 2 GLS Economy ·
3 DerKurier Express · 4 DerKurirr Polo-express · 5 DerKurier Economy ·
6 Dachser · 10 Messenger · 11 Packeta výdajné miesto · 12 exLOG ·
13 Slovenská pošta · 14 Sprinter · 15 Raben · 16 DPD · 17 Pick up ·
18 Interná preprava · 19 Packeta kuriér · 20 UPS · 21 FedEx ·
22 GO! Express · 23 FedEx Express · 24 SKLAD - fullfilment · 25 One by Allegro
(pri e-shope reálne: 1, 2, 10, 11)

## 6. Biznis pravidlá

1. **Kľúč:** `NumAtCard = "merchyou.shop:" + order.name` (presná zhoda).
   Platí pre D2C (zákazník „ZÁKAZNÍK SK“ / „CUSTOMER EU“) aj B2B zákazky
   z e-shopu.
2. **1 dizajn = 1 ZL** typu *On demand* (`U_SFT_DOCTYPE = 5`, obsahuje riadok `S000003`). Viac
   variantov toho istého dizajnu = jedna ZL.
3. **Všetok čistý textil objednávky = 1 ZL** typu *Predaj textilu*
   (`U_SFT_DOCTYPE = 3`, `U_SFT_NOPRINT = Y`).
4. **Reklamačný ZL** má rovnaké `NumAtCard` a `U_SFT_SPECIAL = 'REKLAM'` →
   v1 sa **neposiela** (objednávka je už fulfilled, v appke nie je).
5. **Zdroje pravdy:**

| Údaj | Zdroj pravdy |
|---|---|
| Produkt/variant, ktorý sa vyrába | SAP (riadky ZL) |
| Stav zákazky | SAP (`U_SFT_STATUS`) |
| Dopravca, dodacia adresa | SAP (Logistika) |
| Deadline | appka (Shopify metafield, SPEC §5) — nikdy SAP |
| Dizajny, tlačové súbory | Zakeke |
| Zoznam objednávok (unfulfilled) | Shopify |

6. Status „Odoslané/Odovzdané“ → objednávka sa v Shopify prepne na Fulfilled
   a z appky zmizne.
7. **Zmena textilu v SAP** = množina produktových riadkov ZL (dvojice
   `itemCode` + `quantity`, bez `S…`) sa líši od verzie 1. Porovnáva sa celá
   ZL (1 ZL = 1 dizajn), nie jednotlivé riadky — funguje aj keď support riadok
   zmaže a pridá nový.
   - **Pôvodné riadky** = verzia 1 z logu.
   - **Čas a autor zmeny** = pečiatka najstaršej verzie z nepretržitej
     poslednej série verzií (log + aktuálna), ktorých riadky sa zhodujú
     s aktuálnymi.
   - Výpočet robí server pri prijatí syncu (`lib/sap/history.ts`, unit testy
     na príkladoch §4.13); agent posiela surové verzie.
   - Bez logu (napr. zákazka bez histórie) → `originalLines = null`,
     `textileChange = null`, párovanie fallbackom §7.
8. **Stav zákazky** = aktuálne `U_SFT_STATUS` (text podľa číselníka §5.3).
   Čas pri stave = `syncedAt` snapshotu (kedy appka naposledy dostala dáta zo
   SAP), nie čas zmeny stavu (§4.15).

## 7. Párovanie dizajnu (Zakeke položka) so ZL

Pre jednu objednávku: kandidáti = ZL s `docType = "5"` (On demand), ich produktové riadky
(bez `S…`). Každá ZL sa priradí nanajvýš jednému dizajnu.

0. **Podľa pôvodného SKU (primárne):** Zakeke `productSku` = `itemCode`
   v `originalLines` ZL (verzia 1 = pôvodná Shopify objednávka) → priradiť.
   Funguje aj po výmene za úplne iný produkt. Ak má ZL `textileChange`,
   karta zobrazí zmenu (§10.3).

Fallback, ak ZL nemá `originalLines`:

1. **Presná zhoda:** Zakeke `productSku` = `RDR1.ItemCode` → priradiť.
2. **Iný variant toho istého produktu:** `ItemCode` je SKU iného variantu
   toho istého **originálneho** Shopify produktu (appka ho už dohľadáva podľa
   SKU kvôli skladom, SPEC §3.1) → priradiť + upozornenie
   „Zmenené v SAP: {Dscription}“.
3. **Vylučovacia metóda:** zostane presne 1 nespárovaný dizajn a 1 nespárovaná
   ZL → priradiť + upozornenie „Produkt zmenený v SAP: {Dscription} —
   skontroluj“.
4. **Inak:** dizajn ukáže „ZL: nepriradené“; nespárované ZL sa ukážu
   v hlavičke detailu. (Ručné priradenie — neskoršia verzia.)

Prečo zobrazovať zmeny: výroba triedi textil podľa SAP, ale karta dizajnu ukazuje
variant zo Shopify — bez upozornenia by appka ukazovala inú veľkosť/produkt
než SAP.

Ak SKU nie je jednoznačné (rovnaké SKU vo viacerých ZL), krok 1 páruje
v poradí `DocNum` a duplicity rieši krokom 3/4 — nikdy nehádať potichu.

## 8. API kontrakt `POST /api/sap-sync`

- **Hlavičky:** `Content-Type: application/json`,
  `x-sap-sync-secret: <SAP_SYNC_SECRET>`.
- **Autorizácia:** porovnanie secretu v konštantnom čase
  (`crypto.timingSafeEqual`). Zlý/chýbajúci secret → `401`, bez detailov.
- **Validácia:** schéma (napr. `zod`), max. veľkosť tela 2 MB. Neplatné →
  `400` s popisom chyby. Záznamy s `numAtCard`, ktoré nezačínajú na
  `merchyou.shop:#`, server ignoruje.
- **Ochrana pred vymazaním:** prázdne pole `orders` sa odmietne (`400`),
  pokiaľ telo nemá `"allowEmpty": true` (chyba agenta nesmie zmazať všetko).
- **Odpoveď:** `200 {"ok": true, "orders": <počet ZL>, "shopifyOrders": <počet objednávok>}`.
- Endpoint **nesmie** byť chránený session cookie (volá ho agent), middleware
  ho musí vynechať z presmerovania na `/login`.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-22T14:05:00+02:00",
  "agent": "avd-ps-1.0",
  "orders": [
    {
      "docEntry": 52017,
      "docNum": 212604829,
      "numAtCard": "merchyou.shop:#2045",
      "docType": "5",
      "special": null,
      "status": "21",
      "priority": "H",
      "noPrint": false,
      "shipping": {
        "code": 11,
        "name": "Packeta výdajné miesto",
        "pickupPointId": "34994",
        "pickupPointName": "Z-BOX Bratislava, Limbová 2A"
      },
      "updatedAt": "2026-10-19T12:25:19",
      "updatedBy": "Vladimír Horvát",
      "lines": [
        { "lineNum": 0, "itemCode": "752001", "description": "STTW259, Natural Raw, M", "quantity": 1 }
      ],
      "history": [
        {
          "logInstance": 1,
          "updatedAt": "2026-10-18T23:51:40",
          "updatedBy": "B1i",
          "lines": [
            { "lineNum": 0, "itemCode": "752002", "description": "STTW259, Natural Raw, L", "quantity": 1 }
          ]
        },
        {
          "logInstance": 2,
          "updatedAt": "2026-10-19T07:46:13",
          "updatedBy": "B1i",
          "lines": [
            { "lineNum": 0, "itemCode": "752002", "description": "STTW259, Natural Raw, L", "quantity": 1 }
          ]
        }
      ]
    }
  ]
}
```

- `lines` a `history[].lines` obsahujú len produktové riadky (bez `S…`).
- `updatedAt` = SAP `UpdateDate` + `UpdateTS` ako **lokálny čas bez časovej
  zóny** (`YYYY-MM-DDTHH:mm:ss`); server ho interpretuje ako Europe/Bratislava
  (AVD môže mať inú časovú zónu ako SAP server).
- `history` = verzie z `ADOC`/`ADO1` zoradené podľa `logInstance`; prázdne pole,
  ak log neexistuje.
- Server pri prijatí vypočíta pre každú ZL `originalLines` a `textileChange`
  (`{ changedAt (ISO s offsetom), changedBy, originalLines }` alebo `null`,
  §6.7) a do Upstash uloží **len výsledok**, nie celú históriu.

Prázdne hodnoty posiela agent ako `null` (napr. SAP dátum `1899-12-30` → `null`,
`U_SFT_SPECIAL = '-'` → `null`). `docType` a `status` sa posielajú ako surový
kód (string), význam mapuje appka podľa §5.3. Agent posiela všetky otvorené,
nestornované e-shop ZL okrem `REKLAM` (vrátane statusu 50).

## 9. Úložisko — Upstash Redis

- Pripojenie cez Vercel Marketplace (Storage → Upstash for Redis → pripojiť
  k projektu), klient `@upstash/redis` (`Redis.fromEnv()`).
- Kľúč `sap:snapshot:v1` = jeden JSON:
  `{ syncedAt, receivedAt, agent, byOrderName: { "#2045": [ ...ZL ] } }`.
  Prepisuje sa celý pri každom syncu.
- Appka číta snapshot raz na request, v pamäti servera cache ~60 s.
- Free tier: sync každých 15 min = ~3 000 zápisov/mesiac — hlboko pod limitom.
  Veľkosť snapshotu: ~60 ZL ≈ desiatky kB (cieľ < 1 MB).

## 10. UI v1

### 10.1 Zoznam objednávok — stĺpec „ZL“
- Posledné 4 číslice `DocNum` všetkých ZL objednávky, vzostupne, oddelené
  „, “ (napr. `4829, 4830, 4831`).
- Bez ZL v snapshote → „—“.
- Na mobile (karty) ako jeden riadok „ZL 4829, 4830“.

### 10.2 Dopravca (zoznam aj detail)
Mapovanie podľa **kódu** `shipping.code` (`OSHP.TrnspCode`), nie podľa názvu:

| Kód | Kľúč | Text badge | Štýl (len farby z brandingu, SPEC §9) |
|---|---|---|---|
| 11 | `packeta` | Packeta | existujúci tyrkysový |
| 19 | `packeta_courier` | Packeta kuriér | existujúci tyrkysový |
| 2 | `gls` | GLS | existujúci šedý |
| 10 | `messenger` | Messenger | plná tmavá `#231f20`, biely text |
| 1 | `pickup` | Osobný odber | biele pozadie, tmavý 1px rámik, tmavý text |
| iný | `other` | `shipping.name` zo SAP | svetlošedý rámik |

- Viac ZL s rôznym dopravcom → viac badge (každý dopravca raz).
- **Fallback:** objednávka bez ZL v snapshote → dopravca podľa Shopify tagov
  ako doteraz (SPEC §3.1).
- V **zozname** sa pobočka Packeta nezobrazuje (SPEC v1.2 §4.1), len v detaile.
- Pobočka Packeta (detail): `pickupPointName` zo SAP **len pri kóde 11** (pri iných
  kódoch môžu v SAP zostať staré údaje o pobočke, §4.10). Ak kód 11 a pobočka
  zo SAP chýba → fallback Shopify.

### 10.3 Detail objednávky
- **Doprava:** jeden dopravca → len dopravca (+ pobočka). Viac dopravcov →
  riadok na každého: `GLS – ZL 4819, 4820`.
- **Karta položky:** `ZL: 212604819` (celé číslo) na **samostatnom riadku
  hneď pod hlavičkou karty** (SKU · Vytlačené · Design ID), nie v nej —
  hlavička je na mobile na hranici šírky (SPEC §4.2, ~346 px) a jej
  zalamovanie podľa media query sa nesmie rozbiť.
- **Stav zákazky** v tom istom riadku za číslom ZL: kompaktný pill so
  stavom (text z číselníka §5.3, napr. „Na ceste“) a vedľa drobným šedým
  písmom čas poslednej synchronizácie („aktualizované 23. 10. 14:02“, zo
  `syncedAt`). Ak je `syncedAt` starší než 60 min, čas je zvýraznený ako
  neaktuálny (rovnaké pravidlo ako §10.4). Na úzkom displeji sa pill s časom
  môže zalomiť pod číslo ZL.
  Štýl pillu: neutrálny šedý; stavy **63 Nedostupný textil** a
  **70 Prerušená výroba/Prestoj** s pozadím `--color-warning-bg` (rovnaké ako
  „čaká na SAP“, SPEC §9) — žiadne nové farby.
- **ZL s čistým textilom** (`docType "3"`) nemá kartu dizajnu → v hlavičke
  detailu riadok „Čistý textil: ZL 4830 · {pill stavu} {čas}“.
- **Zmenený textil** (ZL má `textileChange`): ako hlavný údaj o textile sa
  zobrazí aktuálny textil zo SAP (`lines[].description`, množstvo), pod ním
  nenápadný varovný chip „Zmenené v SAP 19. 10. 2026 12:25 · Vladimír Horvát“
  a menším prečiarknutým textom „pôvodne objednané: {Shopify variant}“.
  Skladové hodnoty Shopify sa pri zmenenom textile nezobrazujú (patria
  k pôvodnému SKU).
- Upozornenia z fallback párovania (§7 kroky 2–3) ako rovnaký chip bez času.
- Nespárované ZL (§7 krok 4) v hlavičke: „ZL bez priradeného dizajnu: …“.

### 10.4 Vek dát
- V hlavičke zoznamu malý text „SAP: pred 12 min“ (zo `syncedAt`).
- Starší než 60 min → šedý text „SAP dáta neaktuálne (pred 3 h)“; údaje sa
  stále zobrazia.
- Žiadny snapshot → appka funguje ako pred integráciou, bez chyby.

## 11. Bezpečnostné pravidlá (záväzné)

1. **Do SAP sa nič nezapisuje ani needituje.** Agent robí len `SELECT`.
2. SQL dotaz je **napevno v skripte**. Agent nikdy nevykonáva SQL ani príkazy
   prijaté zvonka.
3. Komunikácia len AVD → Vercel, HTTPS, TLS 1.2+.
4. `SAP_SYNC_SECRET`, SAP heslo a Upstash tokeny nikdy v kóde, chate ani Gite.
   Na Verceli env variables, lokálne `.env.local`, na AVD šifrované cez
   Windows DPAPI (`Export-Clixml`) v profile používateľa.
5. Do Upstash ide len to, čo appka zobrazuje (minimalizácia osobných údajov).
   Adresa sa pridá až s UI, ktoré ju používa.

## 12. Prevádzka a obmedzenia

- Agent beží len počas AVD relácie. Plánovač úloh a správanie odpojenej
  relácie **[OVERIŤ]**.
- DPAPI šifrovanie je viazané na Windows usera **a počítač**. Ak AVD pridelí
  iný session host, uložené heslá nepôjdu dešifrovať → agent vyzve na nové
  zadanie.
- Agent loguje do súboru v profile (bez hesiel a osobných údajov): čas, počet
  ZL, HTTP odpoveď.

## 13. Roadmapa (mimo v1)

- Dodacia adresa zo SAP v detaile (odosielanie zásielok z appky).
- Priorita v UI.
- **Reálny stav textilu u dodávateľa** (vychystané / u kuriéra / tracking) pri
  ZL „Na ceste“ — prieskum: záložka ZL „Krytie textilom“ (pravdepodobne
  vlastná tabuľka SFT addonu → hľadať v `OUTB`), objednávky dodávateľovi
  `OPOR` (polia `U_SFT_TRACKNO`, `U_ENF_TRACKNOSTRING`, `U_SFT_TEXTILDATE`,
  `U_ENF_SSCOMMENTS`), príjemky `OPDN`; mimo SAP prípadne API/portál
  dodávateľa.
- Ručné priradenie dizajnu k ZL (uložené v Upstash) — pri funkčnom logu
  zriedkavé.
- Zmena dopravy/adresy v SAP s časom zmeny (rovnaký princíp ako textil).
- Upozornenie, keď SAP dopravca ≠ Shopify dopravca.
- Automatizácia dodávok v SAP — **samostatná téma, vyžaduje zápis do SAP**,
  teda výnimku z §11.1 a samostatné rozhodnutie.

## 14. Testovacie skripty

`tools/sap-agent/` v repe (bez secretov): `sap-query.ps1` (univerzálny SELECT
test), neskôr `sap-sync-agent.ps1`. Spúšťanie na AVD:
`powershell -ExecutionPolicy Bypass -File "<cesta>\skript.ps1"`.
Súbory ukladať ako UTF-8 s BOM (Windows PowerShell 5.1).
