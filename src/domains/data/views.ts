import type { EntityType, FaroRecord, FaroSnapshot, HistoryEntry } from '../../lib/types';
import {
  allocatedMinutesForArea,
  allocatedMinutesForInterest,
  goalMetric,
  projectMetric,
  type GoalMetric,
  type ProjectMetric,
} from '../analytics';
import { addDays, dateKey, isActivity } from '../analytics/dates';
import { attentionFor, type AttentionResult } from '../attention';
import { habitCalendar, habitProgress, type HabitProgress } from '../habits';
import { weeklySummary, type WeeklySummary } from '../reviews';
import { recordAt } from '../seasons';
import { getSnapshot } from './service';

export interface EntityFilters {
  q?: string;
  status?: string;
  area?: string;
  interest?: string;
  from?: string;
  to?: string;
  sort?: string;
  offset?: string | number;
  limit?: string | number;
}

export interface EntityPage {
  records: FaroRecord[];
  total: number;
  limit: number;
  offset: number;
}
export interface EntitySummary {
  minutes: number;
  sessionCount: number;
  lastActivityAt: string | null;
  habit?: HabitProgress;
  attention?: AttentionResult;
  goal?: GoalMetric;
  project?: ProjectMetric;
  week?: WeeklySummary;
  calendar?: { date: string; sessions: number; minutes: number }[];
}
export interface RecordDetailView {
  record: FaroRecord;
  snapshot: FaroSnapshot;
  summary: EntitySummary;
  activityTotal: number;
  historyTotal: number;
  activityOffset: number;
  historyOffset: number;
}
export interface CompactOptions {
  includeActivities?: boolean;
  activityStart?: string;
  activityEnd?: string;
  includeHistory?: boolean;
}
export interface FaroViewSnapshot extends FaroSnapshot {
  view: {
    activityStart: string;
    activityEnd: string;
    totalActivities: number;
    includedActivities: number;
  };
}

const longFields = [
  'notes',
  'outcomes',
  'reflections',
  'achievements',
  'difficulties',
  'decisions',
  'nextPriorities',
  'references',
] as const;

/** List entries are previews. Editing and reading complete text always loads by ID. */
export function compactRecord(record: FaroRecord, descriptionLength = 200): FaroRecord {
  const preview = { ...record, description: record.description.slice(0, descriptionLength) };
  for (const field of longFields) delete preview[field];
  if (preview.tags) preview.tags = preview.tags.slice(0, 8);
  return preview;
}

export function compactHistory(entry: HistoryEntry): HistoryEntry {
  return {
    ...entry,
    before: entry.before ? compactRecord(entry.before, 0) : null,
    after: entry.after ? compactRecord(entry.after, 0) : null,
  };
}

/** Reference choices exclude lifetime logs; discoveries use remote search beyond 200. */
export function metadataSnapshot(
  snapshot: FaroSnapshot,
  options: { includeIds?: string[] } = {},
): FaroSnapshot {
  const referenceTypes = new Set<EntityType>([
    'areas',
    'interests',
    'goals',
    'habits',
    'projects',
    'seasons',
  ]);
  const discoveries = new Set(
    snapshot.records
      .filter((record) => record.type === 'learnings')
      .sort((a, b) => (b.occurredAt ?? b.createdAt).localeCompare(a.occurredAt ?? a.createdAt))
      .slice(0, 200)
      .map((record) => record.id),
  );
  const explicit = new Set(options.includeIds ?? []);
  return {
    ...snapshot,
    records: snapshot.records
      .filter(
        (record) =>
          referenceTypes.has(record.type) || discoveries.has(record.id) || explicit.has(record.id),
      )
      .map((record) => ({
        id: record.id,
        type: record.type,
        name: record.name,
        description: '',
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        ...(record.areaId ? { areaId: record.areaId } : {}),
        ...(record.interestIds ? { interestIds: record.interestIds } : {}),
        ...(record.habitIds ? { habitIds: record.habitIds } : {}),
        ...(record.projectIds ? { projectIds: record.projectIds } : {}),
        ...(record.goalIds ? { goalIds: record.goalIds } : {}),
        ...(record.priority ? { priority: record.priority } : {}),
        ...(record.color ? { color: record.color } : {}),
        ...(record.icon ? { icon: record.icon } : {}),
        ...(record.order !== undefined ? { order: record.order } : {}),
      })),
    history: [],
  };
}

/** Explicit date-window projection; lifetime metrics must come from server summaries. */
export function compactSnapshot(
  snapshot: FaroSnapshot,
  options: CompactOptions = {},
): FaroViewSnapshot {
  const activityEnd =
    options.activityEnd ?? dateKey(snapshot.generatedAt, snapshot.settings.timezone);
  const activityStart = options.activityStart ?? addDays(activityEnd, -364);
  const activities = snapshot.records.filter((record) => record.type === 'activities');
  const selected =
    options.includeActivities === false
      ? []
      : activities.filter((record) => {
          const day = dateKey(record.occurredAt ?? record.createdAt, snapshot.settings.timezone);
          return day >= activityStart && day <= activityEnd;
        });
  return {
    ...snapshot,
    records: [
      ...snapshot.records.filter((record) => record.type !== 'activities'),
      ...selected,
    ].map((record) => compactRecord(record)),
    history: options.includeHistory === false ? [] : snapshot.history.map(compactHistory),
    view: {
      activityStart,
      activityEnd,
      totalActivities: activities.length,
      includedActivities: selected.length,
    },
  };
}

export async function getViewSnapshot(options: CompactOptions = {}): Promise<FaroViewSnapshot> {
  return compactSnapshot(await getSnapshot(), options);
}

function pageNumber(
  value: string | number | undefined,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = Number(value);
  return value === undefined || !Number.isInteger(parsed) || parsed < 0
    ? fallback
    : Math.min(parsed, max);
}

/** Filters run before projection so searches include complete descriptions and notes. */
export function getEntityPage(
  snapshot: FaroSnapshot,
  type: EntityType,
  filters: EntityFilters = {},
): EntityPage {
  const query = filters.q?.trim().toLocaleLowerCase('es') ?? '';
  const indexed = new Map(snapshot.records.map((record) => [record.id, record]));
  const history = historyIndex(snapshot.history);
  const sort =
    filters.sort ||
    (type === 'areas'
      ? 'order'
      : ['activities', 'learnings', 'reviews', 'progress'].includes(type)
        ? 'recent'
        : 'priority');
  const matches = snapshot.records
    .filter((record) => {
      if (record.type !== type) return false;
      if (
        query &&
        !`${record.name} ${record.description} ${record.notes ?? ''} ${record.tags?.join(' ') ?? ''}`
          .toLocaleLowerCase('es')
          .includes(query)
      )
        return false;
      if (filters.status && record.status !== filters.status) return false;
      if (
        filters.area &&
        (record.type === 'activities'
          ? !activityAreas(record, indexed, history).includes(filters.area)
          : record.areaId !== filters.area &&
            !record.interestIds?.some((id) => indexed.get(id)?.areaId === filters.area))
      )
        return false;
      if (
        filters.interest &&
        record.id !== filters.interest &&
        !record.interestIds?.includes(filters.interest)
      )
        return false;
      const day =
        record.weekStart ??
        record.startDate ??
        dateKey(record.occurredAt ?? record.createdAt, snapshot.settings.timezone);
      return (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to);
    })
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'es')
        : sort === 'order'
          ? (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'es')
          : sort === 'priority'
            ? (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name, 'es')
            : (b.occurredAt ?? b.weekStart ?? b.startDate ?? b.createdAt).localeCompare(
                a.occurredAt ?? a.weekStart ?? a.startDate ?? a.createdAt,
              ),
    );
  const limit = Math.max(1, pageNumber(filters.limit, 12, 100));
  const offset = pageNumber(filters.offset, 0);
  return {
    records: matches.slice(offset, offset + limit).map((record) => compactRecord(record)),
    total: matches.length,
    limit,
    offset,
  };
}

function historyIndex(history: HistoryEntry[]): Map<string, HistoryEntry[]> {
  const indexed = new Map<string, HistoryEntry[]>();
  for (const entry of history) {
    const entries = indexed.get(entry.recordId) ?? [];
    entries.push(entry);
    indexed.set(entry.recordId, entries);
  }
  return indexed;
}

function activityAreas(
  activity: FaroRecord,
  records: Map<string, FaroRecord>,
  history: Map<string, HistoryEntry[]>,
): string[] {
  if (!activity.interestIds?.length) return activity.areaId ? [activity.areaId] : [];
  return [
    ...new Set(
      activity.interestIds
        .map((id) => {
          const interest = records.get(id);
          const changes = history.get(id) ?? [];
          const historical =
            interest && changes.length
              ? recordAt(interest, changes, new Date(activity.occurredAt ?? activity.createdAt))
              : interest;
          return historical?.areaId ?? interest?.areaId ?? activity.areaId;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

function pointsTo(
  source: FaroRecord,
  target: FaroRecord,
  indexed: Map<string, FaroRecord>,
): boolean {
  if (source.id === target.id) return false;
  if (
    source.parentId === target.id ||
    source.activityId === target.id ||
    source.areaId === target.id
  )
    return true;
  if (
    [
      source.interestIds,
      source.habitIds,
      source.projectIds,
      source.goalIds,
      source.learningIds,
      source.focusIds,
      source.maintenanceIds,
      source.explorationIds,
    ].some((ids) => ids?.includes(target.id))
  )
    return true;
  return (
    target.type === 'areas' &&
    Boolean(source.interestIds?.some((id) => indexed.get(id)?.areaId === target.id))
  );
}

function linkedSessions(record: FaroRecord, snapshot: FaroSnapshot): FaroRecord[] {
  const indexed = new Map(snapshot.records.map((entry) => [entry.id, entry]));
  const history = historyIndex(snapshot.history);
  return snapshot.records
    .filter(
      (candidate) =>
        candidate.type === 'activities' &&
        (record.type === 'areas'
          ? activityAreas(candidate, indexed, history).includes(record.id)
          : candidate.id !== record.id &&
            (pointsTo(candidate, record, indexed) || pointsTo(record, candidate, indexed))),
    )
    .sort((a, b) => (b.occurredAt ?? b.createdAt).localeCompare(a.occurredAt ?? a.createdAt));
}

export function entitySummaries(
  snapshot: FaroSnapshot,
  records: FaroRecord[] = snapshot.records.filter((record) => record.type !== 'activities'),
): Record<string, EntitySummary> {
  const summaries: Record<string, EntitySummary> = {};
  const now = new Date(snapshot.generatedAt);
  const today = dateKey(now, snapshot.settings.timezone);
  for (const preview of records) {
    const record = snapshot.records.find((candidate) => candidate.id === preview.id) ?? preview;
    const sessions = linkedSessions(record, snapshot).filter(
      (session) =>
        isActivity(session) && (session.occurredAt ?? session.createdAt) <= snapshot.generatedAt,
    );
    const minutes =
      record.type === 'interests'
        ? allocatedMinutesForInterest(record.id, snapshot.records, now)
        : record.type === 'areas'
          ? allocatedMinutesForArea(record.id, snapshot.records, now, snapshot.history)
          : record.type === 'activities'
            ? isActivity(record) && (record.occurredAt ?? record.createdAt) <= snapshot.generatedAt
              ? (record.durationMinutes ?? 0)
              : 0
            : sessions.reduce((sum, session) => sum + (session.durationMinutes ?? 0), 0);
    const summary: EntitySummary = {
      minutes,
      sessionCount: sessions.length,
      lastActivityAt: sessions[0]?.occurredAt ?? sessions[0]?.createdAt ?? null,
    };
    if (record.type === 'habits') {
      summary.habit = habitProgress(
        record,
        snapshot.records,
        snapshot.settings,
        now,
        snapshot.history,
      );
      summary.calendar = habitCalendar(
        record,
        snapshot.records,
        snapshot.settings,
        addDays(today, -55),
        today,
      );
    }
    if (record.type === 'interests')
      summary.attention = attentionFor(
        record,
        snapshot.records,
        snapshot.settings,
        now,
        snapshot.history,
      );
    if (record.type === 'goals') summary.goal = goalMetric(record, snapshot.records, now);
    if (record.type === 'projects') summary.project = projectMetric(record, snapshot.records);
    if (record.type === 'reviews') {
      const week = weeklySummary(
        snapshot.records,
        snapshot.settings,
        record.weekStart,
        now,
        snapshot.history,
      );
      summary.week = {
        ...week,
        activities: week.activities.map((entry) => compactRecord(entry)),
        completedHabits: week.completedHabits.map((entry) => compactRecord(entry)),
        projectsWithProgress: week.projectsWithProgress.map((entry) => compactRecord(entry)),
        goalsAttended: week.goalsAttended.map((entry) => compactRecord(entry)),
        unattendedAreas: week.unattendedAreas.map((entry) => compactRecord(entry)),
      };
    }
    summaries[record.id] = summary;
  }
  return summaries;
}

export function recordDetailView(
  snapshot: FaroSnapshot,
  id: string,
  options: { activityOffset?: number; historyOffset?: number; limit?: number } = {},
): RecordDetailView | null {
  const record = snapshot.records.find((candidate) => candidate.id === id);
  if (!record) return null;
  const activityOffset = pageNumber(options.activityOffset, 0);
  const historyOffset = pageNumber(options.historyOffset, 0);
  const limit = Math.max(1, pageNumber(options.limit, 50, 100));
  const activities = linkedSessions(record, snapshot).filter(
    (activity) =>
      isActivity(activity) && (activity.occurredAt ?? activity.createdAt) <= snapshot.generatedAt,
  );
  const history = snapshot.history
    .filter((entry) => entry.recordId === id)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const includeIds = [
    record.id,
    ...(record.learningIds ?? []),
    ...(record.focusIds ?? []),
    ...(record.maintenanceIds ?? []),
    ...(record.explorationIds ?? []),
    ...(record.activityId ? [record.activityId] : []),
    ...(record.parentId ? [record.parentId] : []),
  ];
  const metadata = metadataSnapshot(snapshot, { includeIds });
  const projected = new Map(metadata.records.map((entry) => [entry.id, entry]));
  for (const entry of snapshot.records) {
    if (['milestones', 'progress'].includes(entry.type) && entry.parentId === record.id)
      projected.set(entry.id, compactRecord(entry));
  }
  for (const entry of activities.slice(activityOffset, activityOffset + limit))
    projected.set(entry.id, compactRecord(entry));
  projected.set(record.id, compactRecord(record));
  return {
    record,
    snapshot: {
      ...metadata,
      records: [...projected.values()],
      history: history.slice(historyOffset, historyOffset + limit).map(compactHistory),
    },
    summary: entitySummaries(snapshot, [record])[id]!,
    activityTotal: activities.length,
    historyTotal: history.length,
    activityOffset,
    historyOffset,
  };
}
