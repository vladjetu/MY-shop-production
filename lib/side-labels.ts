// Jedna strana produktu môže mať viac tlačových plôch (napr. zástera s hornou a dolnou
// plochou na FRONT) — Zakeke vtedy vráti viac printingFiles s rovnakým sideName
// (areaName je prázdne). Aby boli rozlíšiteľné v UI aj v názve súboru, opakujúce sa
// názvy dostanú poradové číslo v rámci strany ("FRONT 1", "FRONT 2"); strany s jedinou
// plochou ostávajú bez čísla. Číslo je podľa poradia v poli, nie zo segmentu názvu
// súboru (SPEC §3.3) — ten môže byť "2" aj pri jedinej ploche na strane.
export function sideLabels(sides: { sideName: string }[]): string[] {
  const totals = new Map<string, number>();
  for (const side of sides) {
    totals.set(side.sideName, (totals.get(side.sideName) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  return sides.map((side) => {
    if (totals.get(side.sideName) === 1) return side.sideName;
    const order = (seen.get(side.sideName) ?? 0) + 1;
    seen.set(side.sideName, order);
    return `${side.sideName} ${order}`;
  });
}
