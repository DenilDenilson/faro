import type { FaroRecord, HistoryEntry } from '../../lib/types';
import { dateKey, daysBetween } from '../analytics/dates';

export type SeasonRole = 'focus' | 'maintenance' | 'exploration' | null;

export function currentSeason(records: FaroRecord[], today: string): FaroRecord | null {
  return (
    records
      .filter(
        (record) =>
          record.type === 'seasons' &&
          !['paused', 'archived', 'cancelled', 'completed'].includes(record.status) &&
          (!record.startDate || record.startDate <= today) &&
          (!record.endDate || record.endDate >= today),
      )
      .sort((a, b) => (b.startDate ?? b.createdAt).localeCompare(a.startDate ?? a.createdAt))[0] ??
    null
  );
}

/** A direct assignment wins; related areas, goals and projects extend a season's focus. */
export function seasonRoleFor(
  interest: FaroRecord,
  records: FaroRecord[],
  today: string,
): SeasonRole {
  const season = currentSeason(records, today);
  if (!season) return null;
  const levels = [
    ['focusIds', 'focus'],
    ['maintenanceIds', 'maintenance'],
    ['explorationIds', 'exploration'],
  ] as const;
  // An explicitly assigned interest overrides a broader assignment of its area/project.
  for (const [field, role] of levels) if (season[field]?.includes(interest.id)) return role;
  const related = new Set([
    interest.id,
    ...(interest.areaId ? [interest.areaId] : []),
    ...records
      .filter((record) => record.interestIds?.includes(interest.id))
      .map((record) => record.id),
  ]);
  for (const [field, role] of levels) {
    if (season[field]?.some((id) => related.has(id))) return role;
  }
  return null;
}

/** Reconstruct a record as it was at a timestamp; updates never rewrite previous periods. */
export function recordAt(
  record: FaroRecord,
  history: HistoryEntry[],
  instant: Date,
): FaroRecord | null {
  const timestamp = instant.toISOString();
  if (record.createdAt > timestamp) return null;
  const changes = history
    .filter((entry) => entry.recordId === record.id)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const future = changes.find((entry) => entry.occurredAt > timestamp);
  if (future) return future.before;
  return changes.filter((entry) => entry.occurredAt <= timestamp).at(-1)?.after ?? record;
}

/** Calendar days actually active, excluding recorded pause/archive periods. */
export function activeDaysBetween(
  record: FaroRecord,
  history: HistoryEntry[],
  from: string,
  to: string,
  timezone: string,
): number {
  const total = Math.max(0, daysBetween(from, to));
  const changes = history
    .filter((entry) => entry.recordId === record.id)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (!changes.length) return total;
  let status =
    changes.find((entry) => dateKey(entry.occurredAt, timezone) > from)?.before?.status ??
    changes.filter((entry) => dateKey(entry.occurredAt, timezone) <= from).at(-1)?.after?.status ??
    record.status;
  let cursor = from;
  let active = 0;
  for (const change of changes) {
    const day = dateKey(change.occurredAt, timezone);
    if (day <= from || day > to) continue;
    if (!['paused', 'archived', 'cancelled', 'completed'].includes(status))
      active += daysBetween(cursor, day);
    cursor = day;
    status = change.after?.status ?? 'archived';
  }
  if (!['paused', 'archived', 'cancelled', 'completed'].includes(status))
    active += daysBetween(cursor, to);
  return Math.max(0, Math.min(total, active));
}
