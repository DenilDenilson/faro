import type { FaroRecord, HistoryEntry, Settings } from '../../lib/types';
import {
  addDays,
  dateKey,
  dayRange,
  daysBetween,
  isActivity,
  recordDate,
  startOfMonth,
  startOfWeek,
} from './dates';
import { habitPeriods, habitProgress } from '../habits';
import { recordAt } from '../seasons';

export interface AnalyticsFilters {
  startDate?: string;
  endDate?: string;
  areaId?: string;
  interestId?: string;
  projectId?: string;
}
export interface TimePoint {
  date: string;
  minutes: number;
  sessions: number;
}
export interface TimeDistribution {
  id: string;
  name: string;
  minutes: number;
  color: string;
}
export interface GoalMetric {
  id: string;
  name: string;
  currentValue: number | null;
  targetValue: number | null;
  unit: string;
  progress: number | null;
}
export interface ProjectMetric {
  id: string;
  name: string;
  completedMilestones: number;
  totalMilestones: number;
  progress: number | null;
}
export interface HabitMetric {
  id: string;
  name: string;
  completed: boolean;
  progress: number | null;
  sessions: number;
  minutes: number;
  targetCount: number | null;
  targetMinutes: number | null;
  eligiblePeriods: number;
  completedPeriods: number;
  completionRate: number | null;
}
export interface AttentionTrend {
  date: string;
  interestId: string;
  name: string;
  sessions: number;
  activeDays: number;
  averageGapDays: number | null;
}
export interface AnalyticsResult {
  startDate: string;
  endDate: string;
  hasData: boolean;
  totalMinutes: number;
  sessionCount: number;
  activeDays: number;
  interestCount: number;
  areaCount: number;
  previousMinutes: number;
  deltaMinutes: number;
  daily: TimePoint[];
  weekly: TimePoint[];
  monthly: TimePoint[];
  annual: TimePoint[];
  heatmap: TimePoint[];
  byArea: TimeDistribution[];
  byInterest: TimeDistribution[];
  byProject: TimeDistribution[];
  habitCompletion: HabitMetric[];
  goalProgress: GoalMetric[];
  projectProgress: ProjectMetric[];
  attentionTrend: AttentionTrend[];
}

interface Allocation {
  activity: FaroRecord;
  interestId: string;
  areaId: string;
  minutes: number;
}

function allocationsFor(
  activity: FaroRecord,
  records: Map<string, FaroRecord>,
  historyByRecord: Map<string, HistoryEntry[]> = new Map(),
): Allocation[] {
  const ids = [...new Set(activity.interestIds ?? [])];
  if (!ids.length)
    return [
      {
        activity,
        interestId: 'unassigned',
        areaId: activity.areaId ?? 'unassigned',
        minutes: activity.durationMinutes ?? 0,
      },
    ];
  const minutes = (activity.durationMinutes ?? 0) / ids.length;
  return ids.map((id) => {
    const interest = records.get(id);
    const changes = historyByRecord.get(id) ?? [];
    const historical =
      interest && changes.length
        ? recordAt(interest, changes, new Date(activity.occurredAt ?? activity.createdAt))
        : interest;
    return {
      activity,
      interestId: id,
      areaId: historical?.areaId ?? interest?.areaId ?? activity.areaId ?? 'unassigned',
      minutes,
    };
  });
}

function indexHistory(history: HistoryEntry[]): Map<string, HistoryEntry[]> {
  const indexed = new Map<string, HistoryEntry[]>();
  for (const entry of history) {
    const entries = indexed.get(entry.recordId) ?? [];
    entries.push(entry);
    indexed.set(entry.recordId, entries);
  }
  return indexed;
}

function distribution(
  allocations: Allocation[],
  field: 'areaId' | 'interestId',
  records: FaroRecord[],
): TimeDistribution[] {
  const indexed = new Map(records.map((record) => [record.id, record]));
  const buckets = new Map<string, number>();
  for (const allocation of allocations)
    buckets.set(allocation[field], (buckets.get(allocation[field]) ?? 0) + allocation.minutes);
  return [...buckets.entries()]
    .map(([id, minutes]) => {
      const record = indexed.get(id);
      return {
        id,
        name: record?.name ?? 'Sin asignar',
        minutes,
        color: record?.color ?? '#8b9490',
      };
    })
    .sort((a, b) => b.minutes - a.minutes);
}

/** Accumulated attributed time, shared by lists, details and analysis views. */
export function allocatedMinutesForInterest(
  interestId: string,
  records: FaroRecord[],
  now = new Date(),
): number {
  return records
    .filter(
      (record) =>
        isActivity(record) &&
        (record.occurredAt ?? record.createdAt) <= now.toISOString() &&
        record.interestIds?.includes(interestId),
    )
    .reduce(
      (sum, activity) =>
        sum +
        (activity.durationMinutes ?? 0) / Math.max(1, new Set(activity.interestIds ?? []).size),
      0,
    );
}

export function allocatedMinutesForArea(
  areaId: string,
  records: FaroRecord[],
  now = new Date(),
  history: HistoryEntry[] = [],
): number {
  const indexed = new Map(records.map((record) => [record.id, record]));
  const changes = indexHistory(history);
  return records
    .filter(
      (record) =>
        isActivity(record) && (record.occurredAt ?? record.createdAt) <= now.toISOString(),
    )
    .flatMap((activity) => allocationsFor(activity, indexed, changes))
    .filter((allocation) => allocation.areaId === areaId)
    .reduce((sum, allocation) => sum + allocation.minutes, 0);
}

function aggregate(points: TimePoint[], key: (date: string) => string): TimePoint[] {
  const buckets = new Map<string, TimePoint>();
  for (const point of points) {
    const date = key(point.date);
    const bucket = buckets.get(date) ?? { date, minutes: 0, sessions: 0 };
    bucket.minutes += point.minutes;
    bucket.sessions += point.sessions;
    buckets.set(date, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function goalMetric(goal: FaroRecord, records: FaroRecord[], now = new Date()): GoalMetric {
  const latest = records
    .filter(
      (record) =>
        record.type === 'progress' &&
        record.parentId === goal.id &&
        record.value !== undefined &&
        record.status !== 'cancelled' &&
        (record.occurredAt ?? record.createdAt) <= now.toISOString(),
    )
    .sort(
      (a, b) =>
        (a.occurredAt ?? a.createdAt).localeCompare(b.occurredAt ?? b.createdAt) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )
    .at(-1);
  const currentValue = latest?.value ?? goal.currentValue ?? goal.baselineValue ?? null;
  const targetValue = goal.targetValue ?? null;
  return {
    id: goal.id,
    name: goal.name,
    currentValue,
    targetValue,
    unit: goal.unit ?? '',
    progress:
      currentValue !== null && targetValue !== null && targetValue > 0
        ? Math.max(0, Math.min(1, currentValue / targetValue))
        : null,
  };
}

export function projectMetric(project: FaroRecord, records: FaroRecord[]): ProjectMetric {
  const milestones = records.filter(
    (record) =>
      record.type === 'milestones' &&
      (record.parentId === project.id || record.projectIds?.includes(project.id)) &&
      record.status !== 'cancelled' &&
      record.status !== 'archived',
  );
  const completedMilestones = milestones.filter((record) => record.status === 'completed').length;
  return {
    id: project.id,
    name: project.name,
    completedMilestones,
    totalMilestones: milestones.length,
    progress: milestones.length ? completedMilestones / milestones.length : null,
  };
}

/** All time distributions allocate a multi-interest session equally, conserving the original total. */
export function buildAnalytics(
  records: FaroRecord[],
  settings: Settings,
  filters: AnalyticsFilters = {},
  now = new Date(),
  history: HistoryEntry[] = [],
): AnalyticsResult {
  const endDate = filters.endDate ?? dateKey(now, settings.timezone);
  const startDate = filters.startDate ?? addDays(endDate, -29);
  const days = dayRange(startDate, endDate);
  const previousEnd = addDays(startDate, -1);
  const previousStart = addDays(startDate, -days.length);
  const indexed = new Map(records.map((record) => [record.id, record]));
  const changes = indexHistory(history);
  const activities = records.filter(
    (record) =>
      isActivity(record) &&
      (record.occurredAt ?? record.createdAt) <= now.toISOString() &&
      (!filters.projectId || record.projectIds?.includes(filters.projectId)),
  );
  const activityDays = new Map(
    activities.map((activity) => [activity.id, recordDate(activity, settings.timezone)]),
  );
  const activityDay = (activity: FaroRecord) =>
    activityDays.get(activity.id) ?? recordDate(activity, settings.timezone);
  const allAllocations = activities
    .flatMap((activity) => allocationsFor(activity, indexed, changes))
    .filter(
      (allocation) =>
        (!filters.areaId || allocation.areaId === filters.areaId) &&
        (!filters.interestId || allocation.interestId === filters.interestId),
    );
  const selected = allAllocations.filter((allocation) => {
    const day = activityDay(allocation.activity);
    return day >= startDate && day <= endDate;
  });
  const previousMinutes = allAllocations
    .filter((allocation) => {
      const day = activityDay(allocation.activity);
      return day >= previousStart && day <= previousEnd;
    })
    .reduce((sum, allocation) => sum + allocation.minutes, 0);
  const selectedIds = new Set(selected.map((allocation) => allocation.activity.id));
  const byDay = new Map<string, Allocation[]>();
  const byActivity = new Map<string, Allocation[]>();
  for (const allocation of selected) {
    const day = activityDay(allocation.activity);
    const dayValues = byDay.get(day) ?? [];
    dayValues.push(allocation);
    byDay.set(day, dayValues);
    const activityValues = byActivity.get(allocation.activity.id) ?? [];
    activityValues.push(allocation);
    byActivity.set(allocation.activity.id, activityValues);
  }
  const daily = days.map((date) => {
    const matches = byDay.get(date) ?? [];
    return {
      date,
      minutes: matches.reduce((sum, allocation) => sum + allocation.minutes, 0),
      sessions: new Set(matches.map((allocation) => allocation.activity.id)).size,
    };
  });
  const totalMinutes = selected.reduce((sum, allocation) => sum + allocation.minutes, 0);
  const projectMinutes = new Map<string, number>();
  for (const id of selectedIds) {
    const allocations = byActivity.get(id) ?? [];
    const activity = allocations[0]?.activity;
    if (!activity) continue;
    const ids = [...new Set(activity.projectIds ?? [])];
    const minutes = allocations.reduce((sum, allocation) => sum + allocation.minutes, 0);
    for (const projectId of ids.length ? ids : ['unassigned'])
      projectMinutes.set(
        projectId,
        (projectMinutes.get(projectId) ?? 0) + minutes / Math.max(1, ids.length),
      );
  }
  const byProject = [...projectMinutes.entries()]
    .map(([id, minutes]) => {
      const project = indexed.get(id);
      return {
        id,
        name: project?.name ?? 'Sin proyecto',
        minutes,
        color: project?.color ?? '#8b9490',
      };
    })
    .sort((a, b) => b.minutes - a.minutes);
  const relevant = (record: FaroRecord) =>
    (!filters.areaId ||
      record.areaId === filters.areaId ||
      record.interestIds?.some((id) => indexed.get(id)?.areaId === filters.areaId)) &&
    (!filters.interestId || record.interestIds?.includes(filters.interestId));
  const habitCompletion = records
    .filter((record) => record.type === 'habits' && relevant(record))
    .map((habit) => {
      const progress = habitProgress(habit, records, settings, now, history);
      const periods = habitPeriods(
        habit,
        records,
        settings,
        startDate,
        endDate,
        now,
        history,
      ).filter((period) => !period.excused && (!period.open || period.completed));
      const completedPeriods = periods.filter((period) => period.completed).length;
      return {
        id: habit.id,
        name: habit.name,
        completed: progress.completed,
        progress: progress.progress,
        sessions: progress.sessions,
        minutes: progress.minutes,
        targetCount: progress.targetCount,
        targetMinutes: progress.targetMinutes,
        eligiblePeriods: periods.length,
        completedPeriods,
        completionRate: periods.length ? completedPeriods / periods.length : null,
      };
    });
  const trendBuckets = new Map<
    string,
    { date: string; interestId: string; sessions: Set<string>; days: Set<string> }
  >();
  for (const allocation of selected) {
    if (allocation.interestId === 'unassigned') continue;
    const day = activityDay(allocation.activity);
    const date = startOfMonth(day);
    const key = `${allocation.interestId}:${date}`;
    const bucket = trendBuckets.get(key) ?? {
      date,
      interestId: allocation.interestId,
      sessions: new Set<string>(),
      days: new Set<string>(),
    };
    bucket.sessions.add(allocation.activity.id);
    bucket.days.add(day);
    trendBuckets.set(key, bucket);
  }
  const attentionTrend: AttentionTrend[] = [...trendBuckets.values()]
    .map((bucket) => {
      const active = [...bucket.days].sort();
      return {
        date: bucket.date,
        interestId: bucket.interestId,
        name: indexed.get(bucket.interestId)?.name ?? 'Interés',
        sessions: bucket.sessions.size,
        activeDays: active.length,
        averageGapDays:
          active.length > 1
            ? daysBetween(active[0] ?? bucket.date, active.at(-1) ?? bucket.date) /
              (active.length - 1)
            : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return {
    startDate,
    endDate,
    hasData: selectedIds.size > 0,
    totalMinutes,
    sessionCount: selectedIds.size,
    activeDays: daily.filter((point) => point.sessions > 0).length,
    interestCount: new Set(
      selected.map((allocation) => allocation.interestId).filter((id) => id !== 'unassigned'),
    ).size,
    areaCount: new Set(
      selected.map((allocation) => allocation.areaId).filter((id) => id !== 'unassigned'),
    ).size,
    previousMinutes,
    deltaMinutes: totalMinutes - previousMinutes,
    daily,
    weekly: aggregate(daily, startOfWeek),
    monthly: aggregate(daily, startOfMonth),
    annual: aggregate(daily, (date) => `${date.slice(0, 4)}-01-01`),
    heatmap: daily,
    byArea: distribution(selected, 'areaId', records),
    byInterest: distribution(selected, 'interestId', records),
    byProject,
    habitCompletion,
    goalProgress: records
      .filter((record) => record.type === 'goals' && relevant(record))
      .map((goal) => goalMetric(goal, records, now)),
    projectProgress: records
      .filter((record) => record.type === 'projects' && relevant(record))
      .map((project) => projectMetric(project, records)),
    attentionTrend,
  };
}
