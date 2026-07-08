export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("sk-SK", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

const SLOVAK_WEEKDAYS = ["nedeľa", "pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota"];

// Vercel serverové hodiny bežia v UTC — bez explicitnej časovej zóny by appka
// tesne po polnoci SEČ/SELČ ukazovala včerajší dátum/deň v týždni.
export function getTodaySlovakISODate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${year}-${month}-${day}`;
}

export function formatSlovakDayDate(): string {
  const isoDate = getTodaySlovakISODate();
  const [year, month, day] = isoDate.split("-").map(Number);
  // Poludnie UTC je bezpečne v ten istý kalendárny deň aj po prepočte cez
  // akýkoľvek reálny časový posun, takže getUTCDay() dá správny deň v týždni.
  const weekdayIndex = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return `${SLOVAK_WEEKDAYS[weekdayIndex]} ${day}. ${month}. ${year}`;
}

export function isOverdue(deliveryDeadline: string | null): boolean {
  if (!deliveryDeadline) return false;
  return deliveryDeadline < getTodaySlovakISODate();
}
