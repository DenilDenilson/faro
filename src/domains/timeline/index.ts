import type { EntityType, FaroRecord, HistoryEntry } from '../../lib/types';
import { dateKey } from '../analytics/dates';

export interface TimelineEvent {
  id: string;
  recordId: string;
  type: EntityType;
  title: string;
  date: string;
  description: string;
  href: string;
}
export interface TimelineFilters {
  timezone?: string;
  from?: string;
  to?: string;
  types?: EntityType[];
  areaId?: string;
  interestId?: string;
  query?: string;
  offset?: number;
  limit?: number;
}

function completionDate(record: FaroRecord, history: HistoryEntry[]): string {
  const completed = history
    .filter(
      (entry) =>
        entry.recordId === record.id &&
        entry.after?.status === 'completed' &&
        entry.before?.status !== 'completed',
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  const stable =
    'completedAt' in record && typeof record.completedAt === 'string'
      ? record.completedAt
      : undefined;
  return stable ?? completed?.occurredAt ?? record.updatedAt;
}

/** Memory events are independent from tasks; completion dates can be recovered from the audit trail. */
export function buildTimeline(
  records: FaroRecord[],
  filters: TimelineFilters = {},
  history: HistoryEntry[] = [],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const included = new Set(filters.types ?? []);
  const query = filters.query?.trim().toLocaleLowerCase();
  for (const record of records) {
    if (included.size && !included.has(record.type)) continue;
    if (
      filters.areaId &&
      record.areaId !== filters.areaId &&
      record.id !== filters.areaId &&
      !record.interestIds?.some((id) =>
        records.some((interest) => interest.id === id && interest.areaId === filters.areaId),
      )
    )
      continue;
    if (
      filters.interestId &&
      record.id !== filters.interestId &&
      !record.interestIds?.includes(filters.interestId)
    )
      continue;
    if (
      query &&
      !`${record.name} ${record.description} ${record.notes ?? ''}`
        .toLocaleLowerCase()
        .includes(query)
    )
      continue;
    const parent = ['milestones', 'progress'].includes(record.type)
      ? records.find((candidate) => candidate.id === record.parentId)
      : undefined;
    const href = ['milestones', 'progress'].includes(record.type)
      ? parent
        ? `/${parent.type}?id=${encodeURIComponent(parent.id)}`
        : '/timeline'
      : `/${record.type}?id=${encodeURIComponent(record.id)}`;
    const base = { recordId: record.id, type: record.type, description: record.description, href };
    const add = (kind: string, title: string, date: string) =>
      events.push({ ...base, id: `${record.id}:${kind}`, title, date });
    if (record.type === 'activities')
      add('session', record.name, record.occurredAt ?? record.createdAt);
    else if (record.type === 'interests')
      add('created', `Nuevo interés: ${record.name}`, record.createdAt);
    else if (record.type === 'habits')
      add('created', `Nuevo hábito: ${record.name}`, record.createdAt);
    else if (
      record.type === 'projects' ||
      record.type === 'goals' ||
      record.type === 'milestones'
    ) {
      const completions = new Set(
        history
          .filter(
            (event) =>
              event.recordId === record.id &&
              event.after?.status === 'completed' &&
              event.before?.status !== 'completed',
          )
          .map((event) => event.occurredAt),
      );
      if (record.status === 'completed') completions.add(completionDate(record, history));
      const prefix =
        record.type === 'projects'
          ? 'Proyecto completado'
          : record.type === 'goals'
            ? 'Objetivo alcanzado'
            : 'Hito';
      for (const date of completions) add(`completed:${date}`, `${prefix}: ${record.name}`, date);
    } else if (record.type === 'learnings')
      add('learning', record.name, record.occurredAt ?? record.createdAt);
    else if (record.type === 'seasons')
      add('season', `Temporada: ${record.name}`, record.startDate ?? record.createdAt);
    else if (record.type === 'reviews')
      add('review', `Revisión: ${record.name}`, record.weekStart ?? record.createdAt);
    else if (record.type === 'progress')
      add('progress', `Avance: ${record.name}`, record.occurredAt ?? record.createdAt);
  }
  return events
    .filter((event) => {
      const day = dateKey(event.date, filters.timezone ?? 'America/Lima');
      return (
        (!filters.from || day >= filters.from.slice(0, 10)) &&
        (!filters.to || day <= filters.to.slice(0, 10))
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .slice(
      Math.max(0, filters.offset ?? 0),
      (filters.offset ?? 0) + Math.max(1, Math.min(filters.limit ?? 100, 1000)),
    );
}
