// Slovenský pracovný kalendár — pracovný deň je pondelok–piatok mínus dni
// pracovného pokoja SR. Počíta sa výhradne v UTC, aby výsledok nezávisel od
// časovej zóny servera (Vercel funkcie bežia v UTC).

const FIXED_HOLIDAYS: [month: number, day: number][] = [
  [1, 1], // Deň vzniku Slovenskej republiky
  [1, 6], // Zjavenie Pána (Traja králi)
  [5, 1], // Sviatok práce
  [5, 8], // Deň víťazstva nad fašizmom
  [7, 5], // Sviatok svätého Cyrila a Metoda
  [8, 29], // Výročie SNP
  [9, 1], // Deň Ústavy Slovenskej republiky
  [9, 15], // Sedembolestná Panna Mária
  [11, 1], // Sviatok všetkých svätých
  [11, 17], // Deň boja za slobodu a demokraciu
  [12, 24],
  [12, 25],
  [12, 26],
];

function addDaysUTC(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function isSameUTCDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

// Meeusov/Jonesov/Butcherov algoritmus pre gregoriánsky kalendár.
function getEasterSundayUTC(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = marec, 4 = apríl
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(Date.UTC(year, month - 1, day));
}

export function isSlovakPublicHoliday(date: Date): boolean {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  if (FIXED_HOLIDAYS.some(([m, d]) => m === month && d === day)) {
    return true;
  }

  const easterSunday = getEasterSundayUTC(date.getUTCFullYear());
  const goodFriday = addDaysUTC(easterSunday, -2);
  const easterMonday = addDaysUTC(easterSunday, 1);

  return isSameUTCDate(date, goodFriday) || isSameUTCDate(date, easterMonday);
}

export function isBusinessDay(date: Date): boolean {
  const dayOfWeek = date.getUTCDay(); // 0 = nedeľa, 6 = sobota
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  return !isSlovakPublicHoliday(date);
}

// Pripočíta N pracovných dní k dátumu — počíta sa od NASLEDUJÚCEHO dňa
// (samotný `startDate` sa nezapočítava, aj keby to bol pracovný deň).
export function addBusinessDays(startDate: Date, businessDaysToAdd: number): Date {
  let result = new Date(startDate);
  let added = 0;

  while (added < businessDaysToAdd) {
    result = addDaysUTC(result, 1);
    if (isBusinessDay(result)) {
      added += 1;
    }
  }

  return result;
}
