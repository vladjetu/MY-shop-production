import type { SapLine, SapOrder } from "./types";

// Párovanie položiek (Zakeke karta) so ZL podľa docs/SAP-INTEGRATION.md §7.
//
// 1 dizajn = 1 ZL (§6.2), no jeden dizajn môže byť na viacerých kartách — Zakeke
// „aplikovať na všetky veľkosti“ vytvorí pre každú veľkosť samostatnú položku
// s rovnakým Design ID a SAP z nich spraví JEDNU ZL s viacerými riadkami (#2046:
// 1 dizajn, 2 veľkosti = 1 ZL). Páruje sa preto skupina kariet s rovnakým Design
// ID ako celok proti riadkom ZL, nie jednotlivé SKU — rovnaké SKU býva vo viacerých
// ZL tej istej objednávky (#2038: 724064 v 7 ZL s rôznymi dizajnmi).
//
// Kandidáti = ZL s docType "5" (On demand). Každá ZL sa priradí nanajvýš jednému
// dizajnu. Pri rovnakých kandidátoch sa páruje v poradí: dizajny podľa Design ID
// (Zakeke ich čísluje vzostupne v poradí vzniku), ZL podľa docNum (§7 posledný
// odsek; overené na #2038, kde sa poradia zhodujú).

export type MatchCard = {
  designId: string;
  sku: string | null;
  quantity: number;
};

// "original" = krok 0 (pôvodné SKU z histórie), "exact"/"variant"/"elimination" =
// fallback kroky 1–3 pre ZL bez histórie.
export type ZlMatchMethod = "original" | "exact" | "variant" | "elimination";

export type CardZlMatch = {
  zl: SapOrder;
  method: ZlMatchMethod;
  // Aktuálny textil zo SAP, ak sa pre túto kartu líši od Shopify — UI ho vtedy
  // zobrazí namiesto Shopify variantu (§10.3). null = textil sa nemenil.
  // Prázdne pole = riadok karty v ZL už nie je (support ho zmazal bez náhrady).
  changedLines: SapLine[] | null;
};

export type OrderZlMatch = {
  // Rovnaké poradie ako vstupné karty; null = „ZL: nepriradené“ (krok 4).
  cards: (CardZlMatch | null)[];
  // ZL s dizajnom, ktoré nesedia na žiadnu kartu (hlavička detailu).
  unmatchedDesignZls: SapOrder[];
  // ZL s čistým textilom (docType "3") — nemajú kartu dizajnu.
  textileZls: SapOrder[];
};

const DOC_TYPE_DESIGN = "5";
const DOC_TYPE_TEXTILE = "3";

// Riadky bez SKU (textový riadok) a s množstvom 0 (support riadok vynuloval
// namiesto zmazania) sa pri párovaní aj pri zobrazení zmeny ignorujú (§8).
function usable(lines: SapLine[]): SapLine[] {
  return lines.filter((line) => line.itemCode !== null && line.quantity > 0);
}

type ItemQty = { itemCode: string | null; quantity: number };

type Group = {
  designId: string;
  cardIndexes: number[];
  items: ItemQty[];
};

function itemKey(item: ItemQty): string {
  return `${item.itemCode ?? ""}\u0000${item.quantity}`;
}

function sameMultiset(a: ItemQty[], b: ItemQty[]): boolean {
  if (a.length !== b.length) return false;
  const keysA = a.map(itemKey).sort();
  const keysB = b.map(itemKey).sort();
  return keysA.every((key, i) => key === keysB[i]);
}

// Rovnaké SKU bez ohľadu na množstvo (napr. ak by sa množstvo v Zakeke a SAP líšilo).
function sameItemCodes(a: ItemQty[], b: ItemQty[]): boolean {
  if (a.some((item) => !item.itemCode) || b.some((item) => !item.itemCode)) return false;
  const codesA = new Set(a.map((item) => item.itemCode));
  const codesB = new Set(b.map((item) => item.itemCode));
  return codesA.size === codesB.size && Array.from(codesA).every((code) => codesB.has(code));
}

// Krok 2: každý riadok ZL je variant toho istého ORIGINÁLNEHO Shopify produktu ako
// karty skupiny (productIdBySku = dohľadanie originálu podľa SKU, SPEC §3.1).
function sameProducts(group: ItemQty[], lines: ItemQty[], productIdBySku: Map<string, string>): boolean {
  if (group.length !== lines.length) return false;
  const productOf = (item: ItemQty) => (item.itemCode ? productIdBySku.get(item.itemCode) : undefined);
  const groupProducts = group.map(productOf);
  const lineProducts = lines.map(productOf);
  if ([...groupProducts, ...lineProducts].some((id) => !id)) return false;
  const a = new Set(groupProducts);
  const b = new Set(lineProducts);
  return a.size === b.size && Array.from(a).every((id) => b.has(id));
}

function compareDesignIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function groupCards(cards: MatchCard[]): Group[] {
  const groups = new Map<string, Group>();
  cards.forEach((card, index) => {
    let group = groups.get(card.designId);
    if (!group) {
      group = { designId: card.designId, cardIndexes: [], items: [] };
      groups.set(card.designId, group);
    }
    group.cardIndexes.push(index);
    group.items.push({ itemCode: card.sku, quantity: card.quantity });
  });
  return Array.from(groups.values()).sort((a, b) => compareDesignIds(a.designId, b.designId));
}

// Rozdiel multimnožín a − b (každý prvok b „vyškrtne“ nanajvýš jeden prvok a).
function multisetMinus<T extends ItemQty>(a: T[], b: ItemQty[]): T[] {
  const remaining = new Map<string, number>();
  for (const item of b) remaining.set(itemKey(item), (remaining.get(itemKey(item)) ?? 0) + 1);
  return a.filter((item) => {
    const count = remaining.get(itemKey(item)) ?? 0;
    if (count > 0) {
      remaining.set(itemKey(item), count - 1);
      return false;
    }
    return true;
  });
}

// Ktorej karte skupiny patrí zmena. Pri jednej karte je to celý aktuálny obsah ZL.
// Pri viacerých kartách (viac veľkostí jedného dizajnu) sa zmena týka len kariet,
// ktorých pôvodný riadok v ZL už nie je; tie dostanú všetky nové riadky — ktorý
// nový riadok nahradil ktorý pôvodný, sa z dát určiť nedá a appka nehádá.
function assignChangedLines(group: Group, baseline: ItemQty[], current: SapLine[]): (SapLine[] | null)[] {
  if (group.cardIndexes.length === 1) return [current];

  const added = multisetMinus(current, baseline);
  let removed = multisetMinus(baseline, current);
  return group.items.map((item) => {
    const stillRemoved = multisetMinus(removed, [item]);
    if (stillRemoved.length === removed.length) return null;
    removed = stillRemoved;
    return added;
  });
}

export function matchCardsToZl(
  cards: MatchCard[],
  zls: SapOrder[],
  productIdBySku: Map<string, string> = new Map(),
): OrderZlMatch {
  const sortedZls = [...zls].sort((a, b) => a.docNum - b.docNum);
  const candidates = sortedZls.filter((zl) => zl.docType === DOC_TYPE_DESIGN);
  const textileZls = sortedZls.filter((zl) => zl.docType === DOC_TYPE_TEXTILE);

  const groups = groupCards(cards);
  const result: (CardZlMatch | null)[] = cards.map(() => null);
  const usedZls = new Set<SapOrder>();
  const matchedGroups = new Set<Group>();

  function assign(group: Group, zl: SapOrder, method: ZlMatchMethod) {
    usedZls.add(zl);
    matchedGroups.add(group);

    let changed: (SapLine[] | null)[];
    if (method === "exact") {
      changed = group.cardIndexes.map(() => null);
    } else if (method === "original") {
      changed = zl.textileChange
        ? assignChangedLines(group, zl.originalLines ? usable(zl.originalLines) : group.items, usable(zl.lines))
        : group.cardIndexes.map(() => null);
    } else {
      changed = assignChangedLines(group, group.items, usable(zl.lines));
    }

    group.cardIndexes.forEach((cardIndex, i) => {
      result[cardIndex] = { zl, method, changedLines: changed[i] };
    });
  }

  function pass(method: ZlMatchMethod, fits: (group: Group, zl: SapOrder) => boolean) {
    for (const group of groups) {
      if (matchedGroups.has(group)) continue;
      const zl = candidates.find((candidate) => !usedZls.has(candidate) && fits(group, candidate));
      if (zl) assign(group, zl, method);
    }
  }

  // Krok 0 — pôvodné SKU (verzia 1 z histórie). Funguje aj po výmene za iný produkt.
  pass("original", (group, zl) => zl.originalLines !== null && sameMultiset(group.items, usable(zl.originalLines)));
  pass("original", (group, zl) => zl.originalLines !== null && sameItemCodes(group.items, usable(zl.originalLines)));

  // Fallback len pre ZL bez histórie (originalLines = null).
  // Krok 1 — presná zhoda SKU s aktuálnymi riadkami.
  pass("exact", (group, zl) => zl.originalLines === null && sameMultiset(group.items, usable(zl.lines)));
  pass("exact", (group, zl) => zl.originalLines === null && sameItemCodes(group.items, usable(zl.lines)));
  // Krok 2 — iný variant toho istého originálneho produktu.
  pass(
    "variant",
    (group, zl) => zl.originalLines === null && sameProducts(group.items, usable(zl.lines), productIdBySku),
  );

  // Krok 3 — vylučovacia metóda: presne 1 nespárovaný dizajn a 1 nespárovaná ZL.
  const leftGroups = groups.filter((group) => !matchedGroups.has(group));
  const leftZls = candidates.filter((zl) => !usedZls.has(zl));
  if (leftGroups.length === 1 && leftZls.length === 1 && leftZls[0].originalLines === null) {
    assign(leftGroups[0], leftZls[0], "elimination");
  }

  // Krok 4 — zvyšok ostáva nepriradený (karta „ZL: nepriradené“, ZL v hlavičke).
  return {
    cards: result,
    unmatchedDesignZls: candidates.filter((zl) => !usedZls.has(zl)),
    textileZls,
  };
}

// SKU, pre ktoré treba dohľadať originálny Shopify produkt (krok 2) — len ak má
// objednávka ZL s dizajnom bez histórie; inak sa zbytočne nevolá Shopify.
export function skusNeedingProductLookup(cards: MatchCard[], zls: SapOrder[]): string[] {
  const withoutHistory = zls.filter((zl) => zl.docType === DOC_TYPE_DESIGN && zl.originalLines === null);
  if (withoutHistory.length === 0) return [];
  const skus = new Set<string>();
  for (const card of cards) if (card.sku) skus.add(card.sku);
  for (const zl of withoutHistory) for (const line of usable(zl.lines)) skus.add(line.itemCode as string);
  return Array.from(skus);
}

// ---------- Čistý textil (docType "3") ----------

// Položka objednávky bez personalizácie (Shopify line item bez Zakeke dizajnu).
export type TextileItem = {
  sku: string | null;
  quantity: number;
};

// Všetok čistý textil objednávky = 1 ZL (§6.3), viac položiek teda zdieľa jednu
// ZL. Každá položka sa páruje samostatne: primárne podľa pôvodného SKU
// (originalLines), fallback presná zhoda SKU s aktuálnymi riadkami. Zmena textilu
// sa týka len položky, ktorej pôvodný riadok v ZL už nie je; dostane nové riadky
// ZL (rovnaký princíp ako pri dizajne na viacerých kartách).
export function matchTextileItemsToZl(
  items: TextileItem[],
  zls: SapOrder[],
): { items: (CardZlMatch | null)[]; unmatchedTextileZls: SapOrder[] } {
  const textileZls = zls.filter((zl) => zl.docType === DOC_TYPE_TEXTILE).sort((a, b) => a.docNum - b.docNum);
  const removedByZl = new Map<SapOrder, SapLine[]>();
  const addedByZl = new Map<SapOrder, SapLine[]>();
  for (const zl of textileZls) {
    if (!zl.textileChange || !zl.originalLines) continue;
    removedByZl.set(zl, multisetMinus(usable(zl.originalLines), usable(zl.lines)));
    addedByZl.set(zl, multisetMinus(usable(zl.lines), usable(zl.originalLines)));
  }

  const usedZls = new Set<SapOrder>();
  const result = items.map((item): CardZlMatch | null => {
    if (!item.sku) return null;
    const hasSku = (lines: SapLine[]) => usable(lines).some((line) => line.itemCode === item.sku);

    const byOriginal = textileZls.find((zl) => zl.originalLines !== null && hasSku(zl.originalLines));
    const zl = byOriginal ?? textileZls.find((candidate) => hasSku(candidate.lines));
    if (!zl) return null;
    usedZls.add(zl);

    let changedLines: SapLine[] | null = null;
    const removed = removedByZl.get(zl);
    if (byOriginal && removed) {
      const index = removed.findIndex((line) => line.itemCode === item.sku);
      if (index >= 0) {
        removed.splice(index, 1);
        changedLines = addedByZl.get(zl) ?? [];
      }
    }
    return { zl, method: byOriginal ? "original" : "exact", changedLines };
  });

  return { items: result, unmatchedTextileZls: textileZls.filter((zl) => !usedZls.has(zl)) };
}

// ---------- Celá objednávka ----------

export type OrderZlMatchAll = {
  cards: (CardZlMatch | null)[];
  textileItems: (CardZlMatch | null)[];
  // Všetky ZL bez priradenej položky (hlavička detailu), vzostupne podľa docNum:
  // nespárované ZL s dizajnom, čistý textil bez položky a ZL bez docType (tie sa
  // nepárujú vôbec — nevieme, či ide o dizajn alebo čistý textil).
  unmatchedZls: SapOrder[];
};

export function matchOrderToZl(
  cards: MatchCard[],
  textileItems: TextileItem[],
  zls: SapOrder[],
  productIdBySku: Map<string, string> = new Map(),
): OrderZlMatchAll {
  const designs = matchCardsToZl(cards, zls, productIdBySku);
  const textile = matchTextileItemsToZl(textileItems, zls);
  const untyped = zls.filter((zl) => zl.docType === null);
  return {
    cards: designs.cards,
    textileItems: textile.items,
    unmatchedZls: [...designs.unmatchedDesignZls, ...textile.unmatchedTextileZls, ...untyped].sort(
      (a, b) => a.docNum - b.docNum,
    ),
  };
}
