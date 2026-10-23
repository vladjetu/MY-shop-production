import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchCardsToZl,
  matchOrderToZl,
  matchTextileItemsToZl,
  skusNeedingProductLookup,
  type MatchCard,
} from "./match";
import type { SapLine, SapOrder } from "./types";

function line(itemCode: string, description = itemCode, quantity = 1, lineNum = 0): SapLine {
  return { lineNum, itemCode, description, quantity };
}

function zl(docNum: number, lines: SapLine[], extra: Partial<SapOrder> = {}): SapOrder {
  return {
    docEntry: docNum - 212600000,
    docNum,
    numAtCard: "merchyou.shop:#9999",
    docType: "5",
    special: null,
    status: "21",
    priority: "H",
    noPrint: false,
    shipping: { code: 11, name: "Packeta výdajné miesto", pickupPointId: "1", pickupPointName: "Z-BOX" },
    updatedAt: "2026-10-19T07:46:04",
    updatedBy: "B1i",
    lines,
    originalLines: lines,
    textileChange: null,
    ...extra,
  };
}

function card(designId: string, sku: string | null, quantity = 1): MatchCard {
  return { designId, sku, quantity };
}

// Reálne dáta #2045 zo snapshotu 23. 10. 2026 (§4.3, §4.5, §4.13): 5 ZL —
// 4 s dizajnom (2 so zmenou L → M) + 1 čistý textil.
const L_4829 = line("752002", "STTW259, Natural Raw, L");
const M_4829 = line("752001", "STTW259, Natural Raw, M");
const L_4833 = line("G000822", "AKCIA - BY120, White, L");
const M_4833 = line("G000821", "AKCIA - BY120, White, M");

const ZL_2045 = [
  zl(212604829, [M_4829], {
    updatedAt: "2026-10-19T12:25:19",
    updatedBy: "Vladimír Horvát",
    originalLines: [L_4829],
    textileChange: { changedAt: "2026-10-19T12:25:19+02:00", changedBy: "Vladimír Horvát", originalLines: [L_4829] },
  }),
  zl(212604830, [line("446502", "TB4420, Black, L")], { docType: "3", noPrint: true, status: "40" }),
  zl(212604831, [line("466482", "BY101, Duskrose, XL")]),
  zl(212604832, [line("477302", "STAU891, Heather Grey, OS")]),
  zl(212604833, [M_4833], {
    status: "40",
    updatedAt: "2026-10-19T13:16:29",
    originalLines: [L_4833],
    textileChange: { changedAt: "2026-10-19T12:31:00+02:00", changedBy: "Vladimír Horvát", originalLines: [L_4833] },
  }),
];

// Zakeke položky #2045 (Shopify SKU = pôvodné, pred zmenou v SAP).
const CARDS_2045 = [
  card("103123923", "752002"),
  card("103123924", "466482"),
  card("103123926", "477302"),
  card("103123927", "G000822"),
];

test("#2045: párovanie cez pôvodné SKU, 2 položky so zmenou textilu", () => {
  const result = matchCardsToZl(CARDS_2045, ZL_2045);

  assert.deepEqual(
    result.cards.map((match) => match?.zl.docNum),
    [212604829, 212604831, 212604832, 212604833],
  );
  assert.ok(result.cards.every((match) => match?.method === "original"));
  assert.deepEqual(result.cards[0]?.changedLines, [M_4829]);
  assert.equal(result.cards[1]?.changedLines, null);
  assert.equal(result.cards[2]?.changedLines, null);
  assert.deepEqual(result.cards[3]?.changedLines, [M_4833]);

  assert.deepEqual(result.textileZls.map((z) => z.docNum), [212604830]);
  assert.deepEqual(result.unmatchedDesignZls, []);
});

test("#2045: poradie kariet nehrá rolu, ZL s čistým textilom sa nikdy nepriradí karte", () => {
  const result = matchCardsToZl([...CARDS_2045].reverse(), ZL_2045);
  assert.deepEqual(
    result.cards.map((match) => match?.zl.docNum),
    [212604833, 212604832, 212604831, 212604829],
  );
});

test("výmena za úplne iný produkt: párovanie cez pôvodné SKU, karta ukáže nový produkt", () => {
  const original = line("752002", "STTW259, Natural Raw, L");
  const swapped = line("999001", "BY102, Black, M");
  const zls = [
    zl(212605001, [swapped], {
      originalLines: [original],
      textileChange: { changedAt: "2026-10-20T09:00:00+02:00", changedBy: "Support", originalLines: [original] },
    }),
    zl(212605002, [line("466482")]),
  ];

  const result = matchCardsToZl([card("1", "752002"), card("2", "466482")], zls);

  assert.equal(result.cards[0]?.zl.docNum, 212605001);
  assert.equal(result.cards[0]?.method, "original");
  assert.deepEqual(result.cards[0]?.changedLines, [swapped]);
  assert.equal(result.cards[1]?.changedLines, null);
});

test("bez histórie, krok 1: presná zhoda SKU s aktuálnymi riadkami, bez zmeny", () => {
  const zls = [zl(212605010, [line("111")], { originalLines: null }), zl(212605011, [line("222")], { originalLines: null })];
  const result = matchCardsToZl([card("2", "222"), card("1", "111")], zls);

  assert.deepEqual(result.cards.map((m) => [m?.zl.docNum, m?.method, m?.changedLines]), [
    [212605011, "exact", null],
    [212605010, "exact", null],
  ]);
});

test("bez histórie, krok 2: iný variant toho istého originálneho produktu", () => {
  const m = line("752001", "STTW259, Natural Raw, M");
  const zls = [zl(212605020, [m], { originalLines: null }), zl(212605021, [line("466482")], { originalLines: null })];
  const productIdBySku = new Map([
    ["752002", "gid://shopify/Product/1"],
    ["752001", "gid://shopify/Product/1"],
    ["466482", "gid://shopify/Product/2"],
  ]);

  const result = matchCardsToZl([card("1", "752002"), card("2", "466482")], zls, productIdBySku);

  assert.equal(result.cards[0]?.zl.docNum, 212605020);
  assert.equal(result.cards[0]?.method, "variant");
  assert.deepEqual(result.cards[0]?.changedLines, [m]);
  assert.equal(result.cards[1]?.method, "exact");
});

test("bez histórie, krok 2 bez dohľadaného produktu → krok 3 vylučovacia metóda", () => {
  const other = line("999001", "BY102, Black, M");
  const zls = [zl(212605030, [other], { originalLines: null }), zl(212605031, [line("466482")], { originalLines: null })];

  const result = matchCardsToZl([card("1", "752002"), card("2", "466482")], zls);

  assert.equal(result.cards[0]?.zl.docNum, 212605030);
  assert.equal(result.cards[0]?.method, "elimination");
  assert.deepEqual(result.cards[0]?.changedLines, [other]);
  assert.deepEqual(result.unmatchedDesignZls, []);
});

test("bez histórie, krok 4: dva nespárované dizajny a dve ZL → nič sa nehádá", () => {
  const zls = [
    zl(212605040, [line("901")], { originalLines: null }),
    zl(212605041, [line("902")], { originalLines: null }),
  ];

  const result = matchCardsToZl([card("1", "101"), card("2", "102")], zls);

  assert.deepEqual(result.cards, [null, null]);
  assert.deepEqual(result.unmatchedDesignZls.map((z) => z.docNum), [212605040, 212605041]);
});

test("vylučovacia metóda sa nepoužije na ZL s históriou (tá sa páruje len cez pôvodné SKU)", () => {
  const result = matchCardsToZl([card("1", "101")], [zl(212605050, [line("901")])]);
  assert.deepEqual(result.cards, [null]);
  assert.deepEqual(result.unmatchedDesignZls.map((z) => z.docNum), [212605050]);
});

test("viac veľkostí jedného dizajnu = jedna ZL s viacerými riadkami (#2046)", () => {
  const zls = [zl(212604837, [line("724259", "M", 4, 0), line("724258", "S", 3, 1)])];
  const result = matchCardsToZl([card("103124787", "724259", 4), card("103124787", "724258", 3)], zls);

  assert.deepEqual(result.cards.map((m) => m?.zl.docNum), [212604837, 212604837]);
  assert.deepEqual(result.cards.map((m) => m?.changedLines), [null, null]);
});

test("rovnaké SKU v rôznych ZL (#2038): páruje sa celá skupina, rovnaké skupiny v poradí Design ID ↔ docNum", () => {
  const zls = [
    zl(212604788, [line("724064"), line("724063")]),
    zl(212604791, [line("724064")]),
    zl(212604793, [line("724063"), line("724064")]),
  ];
  // Zakeke vracia karty premiešané; skupiny s rovnakým obsahom sa zoradia podľa Design ID.
  const cards = [
    card("103112021", "724063"),
    card("103112015", "724064"),
    card("103112018", "724064"),
    card("103112015", "724063"),
    card("103112021", "724064"),
  ];

  const result = matchCardsToZl(cards, zls);

  assert.deepEqual(result.cards.map((m) => m?.zl.docNum), [212604793, 212604788, 212604791, 212604788, 212604793]);
});

test("zmena jednej veľkosti v ZL s viacerými riadkami: zmenená je len karta, ktorej riadok zmizol", () => {
  const s = line("724063", "S");
  const mOld = line("724064", "M");
  const lNew = line("724065", "L");
  const zls = [
    zl(212605060, [s, lNew], {
      originalLines: [mOld, s],
      textileChange: { changedAt: "2026-10-21T10:00:00+02:00", changedBy: "Support", originalLines: [mOld, s] },
    }),
  ];

  const result = matchCardsToZl([card("1", "724064"), card("1", "724063")], zls);

  assert.deepEqual(result.cards[0]?.changedLines, [lNew]);
  assert.equal(result.cards[1]?.changedLines, null);
});

test("objednávka bez ZL v snapshote → všetko nepriradené, bez chyby", () => {
  const result = matchCardsToZl([card("1", "101")], []);
  assert.deepEqual(result, { cards: [null], unmatchedDesignZls: [], textileZls: [] });
});

test("dohľadanie produktov len ak má objednávka ZL s dizajnom bez histórie", () => {
  assert.deepEqual(skusNeedingProductLookup(CARDS_2045, ZL_2045), []);
  const zls = [zl(212605070, [line("752001")], { originalLines: null })];
  assert.deepEqual(skusNeedingProductLookup([card("1", "752002")], zls).sort(), ["752001", "752002"]);
});

test("riadky bez SKU a s množstvom 0 sa pri párovaní ignorujú", () => {
  const zls = [
    zl(212605080, [line("111"), { lineNum: 1, itemCode: null, description: null, quantity: 1 }, line("222", "222", 0, 2)], {
      originalLines: [line("111"), line("222", "222", 0, 1)],
    }),
  ];
  const result = matchCardsToZl([card("1", "111")], zls);
  assert.equal(result.cards[0]?.zl.docNum, 212605080);
  assert.equal(result.cards[0]?.changedLines, null);
});

// ---------- Čistý textil ----------

test("#2045: položka bez personalizácie sa spáruje so ZL čistého textilu 4830 cez pôvodné SKU", () => {
  const result = matchTextileItemsToZl([{ sku: "446502", quantity: 1 }], ZL_2045);
  assert.equal(result.items[0]?.zl.docNum, 212604830);
  assert.equal(result.items[0]?.method, "original");
  assert.equal(result.items[0]?.changedLines, null);
  assert.deepEqual(result.unmatchedTextileZls, []);
});

test("čistý textil: viac položiek zdieľa jednu ZL, zmenená je len položka, ktorej riadok zmizol", () => {
  const black = line("418099", "Black, L");
  const whiteL = line("G000822", "White, L", 1, 1);
  const whiteM = line("G000821", "White, M", 1, 1);
  const zls = [
    zl(212604863, [black, whiteM], {
      docType: "3",
      originalLines: [black, whiteL],
      textileChange: { changedAt: "2026-10-22T09:00:00+02:00", changedBy: "Support", originalLines: [black, whiteL] },
    }),
  ];

  const result = matchTextileItemsToZl([{ sku: "418099", quantity: 1 }, { sku: "G000822", quantity: 1 }], zls);

  assert.deepEqual(result.items.map((m) => m?.zl.docNum), [212604863, 212604863]);
  assert.equal(result.items[0]?.changedLines, null);
  assert.deepEqual(result.items[1]?.changedLines, [whiteM]);
});

test("čistý textil bez histórie (#2031): fallback presná zhoda SKU, nespárovaná položka → null", () => {
  const zls = [zl(212604733, [line("573690"), line("752857", "752857", 1, 1)], { docType: "3", originalLines: null })];
  const result = matchTextileItemsToZl(
    [{ sku: "573690", quantity: 1 }, { sku: "752857", quantity: 1 }, { sku: "999999", quantity: 1 }],
    zls,
  );
  assert.deepEqual(result.items.map((m) => [m?.zl.docNum, m?.method]), [
    [212604733, "exact"],
    [212604733, "exact"],
    [undefined, undefined],
  ]);
});

test("ZL s dizajnom sa nikdy nepriradí položke čistého textilu", () => {
  const result = matchTextileItemsToZl([{ sku: "752002", quantity: 1 }], ZL_2045);
  assert.deepEqual(result.items, [null]);
});

test("celá objednávka: ZL bez docType sa nepáruje a je medzi nespárovanými, spolu s čistým textilom bez položky", () => {
  const untyped = zl(212604834, [line("752002")], { docType: null, status: null });
  const result = matchOrderToZl(CARDS_2045, [], [...ZL_2045, untyped]);

  assert.deepEqual(result.cards.map((m) => m?.zl.docNum), [212604829, 212604831, 212604832, 212604833]);
  assert.deepEqual(result.unmatchedZls.map((z) => z.docNum), [212604830, 212604834]);
});

test("#2045 celá objednávka: 4 karty + 1 položka čistého textilu, nič nespárované", () => {
  const result = matchOrderToZl(CARDS_2045, [{ sku: "446502", quantity: 1 }], ZL_2045);
  assert.deepEqual(result.textileItems.map((m) => m?.zl.docNum), [212604830]);
  assert.deepEqual(result.unmatchedZls, []);
});
