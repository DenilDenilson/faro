import type { FaroRecord } from '../../lib/types';

const DAY_MS = 86_400_000;
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const instantFormatters = new Map<string, Intl.DateTimeFormat>();
const midnightInstants = new Map<string, number>();

function formatterFor(timezone: string, includeTime = false): Intl.DateTimeFormat {
  const cache = includeTime ? instantFormatters : dateFormatters;
  let formatter = cache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(includeTime
        ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' as const }
        : {}),
    });
    if (cache.size >= 32) cache.clear();
    cache.set(timezone, formatter);
  }
  return formatter;
}

/** Calendar day in the user's zone, never the server's local timezone. */
export function dateKey(input: string | Date, timezone = 'America/Lima'): string {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const date = typeof input === 'string' ? new Date(input) : input;
  if (!Number.isFinite(date.getTime())) throw new RangeError('Fecha inválida');
  const parts = formatterFor(timezone).formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);
}

/** ISO weekday: Monday 1, Sunday 7. */
export function weekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
}

export function startOfWeek(day: string): string {
  return addDays(day, 1 - weekday(day));
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function endOfMonth(day: string): string {
  const date = new Date(`${startOfMonth(day)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

export function dayRange(start: string, end: string): string[] {
  const count = daysBetween(start, end);
  if (count < 0) return [];
  if (count > 36_600) throw new RangeError('El período supera cien años');
  return Array.from({ length: count + 1 }, (_, index) => addDays(start, index));
}

export function recordDate(record: FaroRecord, timezone = 'America/Lima'): string {
  return dateKey(record.occurredAt ?? record.createdAt, timezone);
}

export function isActivity(record: FaroRecord): boolean {
  return record.type === 'activities' && record.status !== 'cancelled';
}

/** Resolve local midnight with zone offsets, including daylight-saving transitions. */
export function dayInstant(day: string, timezone: string): Date {
  const cacheKey = `${timezone}:${day}`;
  const cached = midnightInstants.get(cacheKey);
  if (cached !== undefined) return new Date(cached);
  const desired = Date.parse(`${day}T00:00:00Z`);
  let instant = desired;
  const formatter = formatterFor(timezone, true);
  for (let pass = 0; pass < 4; pass++) {
    const parts = formatter.formatToParts(new Date(instant));
    const get = (name: string) => parts.find((part) => part.type === name)?.value ?? '00';
    const localAsUtc = Date.parse(
      `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`,
    );
    const corrected = instant + desired - localAsUtc;
    if (corrected === instant) break;
    instant = corrected;
  }
  if (midnightInstants.size >= 8192) midnightInstants.clear();
  midnightInstants.set(cacheKey, instant);
  return new Date(instant);
}

export function endOfDay(day: string, timezone: string): Date {
  return new Date(dayInstant(addDays(day, 1), timezone).getTime() - 1);
}

export function latestDate(values: string[]): string | null {
  return (
    values
      .filter((value) => Number.isFinite(Date.parse(value)))
      .sort()
      .at(-1) ?? null
  );
}
