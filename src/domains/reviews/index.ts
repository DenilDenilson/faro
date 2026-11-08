import type { FaroRecord, HistoryEntry, Settings } from '../../lib/types';
import {
  addDays,
  dateKey,
  endOfDay,
  isActivity,
  recordDate,
  startOfWeek,
} from '../analytics/dates';
import { habitProgress } from '../habits';
import { recordAt } from '../seasons';

export interface WeeklyHabitSummary {
  habitId: string;
  name: string;
  completedPeriods: number;
  scheduledPeriods: number;
  compliance: number | null;
}

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  totalMinutes: number;
  activityCount: number;
  activities: FaroRecord[];
  completedHabits: FaroRecord[];
  habitSummaries: WeeklyHabitSummary[];
  projectsWithProgress: FaroRecord[];
  goalsAttended: FaroRecord[];
  unattendedAreas: FaroRecord[];
  previousMinutes: number;
  minutesChange: number;
  activityChange: number;
}

/** Calendar-week totals count each activity exactly once, regardless of its links. */
export function weeklySummary(
  records: FaroRecord[],
  settings: Settings,
  weekStart?: string,
  now: Date = new Date(),
  history: HistoryEntry[] = [],
): WeeklySummary {
  const today = dateKey(now, settings.timezone);
  const start = startOfWeek(weekStart ?? today);
  const end = addDays(start, 6);
  const previousStart = addDays(start, -7);
  const endInstant = endOfDay(end, settings.timezone);
  const reviewInstant = endInstant.getTime() < now.getTime() ? endInstant : now;
  const activities = records.filter((record) => {
    if (!isActivity(record) || (record.occurredAt ?? record.createdAt) > now.toISOString())
      return false;
    const day = recordDate(record, settings.timezone);
    return day >= start && day <= end;
  });
  const previousActivities = records.filter((record) => {
    if (!isActivity(record) || (record.occurredAt ?? record.createdAt) > now.toISOString())
      return false;
    const day = recordDate(record, settings.timezone);
    return day >= previousStart && day < start;
  });
  const totalMinutes = activities.reduce(
    (sum, activity) => sum + (activity.durationMinutes ?? 0),
    0,
  );
  const previousMinutes = previousActivities.reduce(
    (sum, activity) => sum + (activity.durationMinutes ?? 0),
    0,
  );
  const activityIds = new Set(activities.map((activity) => activity.id));
  const areaIds = new Set(
    activities.flatMap((activity) => (activity.areaId ? [activity.areaId] : [])),
  );
  for (const activity of activities) {
    const instant = new Date(activity.occurredAt ?? activity.createdAt);
    for (const interestId of activity.interestIds ?? []) {
      const interest = records.find(
        (record) => record.type === 'interests' && record.id === interestId,
      );
      const historical = interest ? recordAt(interest, history, instant) : null;
      if (historical?.areaId) areaIds.add(historical.areaId);
    }
  }
  const projectIds = new Set(activities.flatMap((activity) => activity.projectIds ?? []));
  const goalIds = new Set(activities.flatMap((activity) => activity.goalIds ?? []));
  for (const record of records) {
    const completion = history
      .filter(
        (entry) =>
          entry.recordId === record.id &&
          entry.after?.status === 'completed' &&
          entry.before?.status !== 'completed',
      )
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]?.occurredAt;
    const stableCompletion =
      'completedAt' in record && typeof record.completedAt === 'string'
        ? record.completedAt
        : completion;
    const day =
      record.status === 'completed' && ['projects', 'goals', 'milestones'].includes(record.type)
        ? dateKey(stableCompletion ?? record.updatedAt, settings.timezone)
        : recordDate(record, settings.timezone);
    if (day < start || day > end) continue;
    if (
      (record.type === 'progress' ||
        (record.type === 'milestones' && record.status === 'completed')) &&
      record.parentId
    ) {
      const parent = records.find((candidate) => candidate.id === record.parentId);
      if (parent?.type === 'projects') projectIds.add(parent.id);
      if (parent?.type === 'goals') goalIds.add(parent.id);
    }
    if (record.type === 'projects' && record.status === 'completed') projectIds.add(record.id);
    if (record.type === 'goals' && record.status === 'completed') goalIds.add(record.id);
    if (record.activityId && activityIds.has(record.activityId)) {
      for (const id of record.projectIds ?? []) projectIds.add(id);
      for (const id of record.goalIds ?? []) goalIds.add(id);
    }
  }
  // Reopening an achieved result does not erase its earlier completion event.
  for (const event of history) {
    if (
      !event.after ||
      event.after.status !== 'completed' ||
      event.before?.status === 'completed' ||
      event.occurredAt > now.toISOString()
    )
      continue;
    const day = dateKey(event.occurredAt, settings.timezone);
    if (day < start || day > end) continue;
    if (event.type === 'projects') projectIds.add(event.recordId);
    if (event.type === 'goals') goalIds.add(event.recordId);
    if (event.type === 'milestones' && event.after.parentId) {
      const parent = records.find((record) => record.id === event.after?.parentId);
      if (parent?.type === 'projects') projectIds.add(parent.id);
      if (parent?.type === 'goals') goalIds.add(parent.id);
    }
  }
  const habitSummaries: WeeklyHabitSummary[] = [];
  const completedHabits: FaroRecord[] = [];
  const lastDay = end < today ? end : today;
  for (const habit of records.filter((record) => record.type === 'habits')) {
    const periods = new Map<string, { completed: boolean; scheduled: boolean; excused: boolean }>();
    for (let day = start; day <= lastDay; day = addDays(day, 1)) {
      const progress = habitProgress(
        habit,
        records,
        settings,
        day === today ? now : endOfDay(day, settings.timezone),
        history,
      );
      const periodId = `${progress.periodStart}:${progress.periodEnd}`;
      const previous = periods.get(periodId);
      periods.set(periodId, {
        completed: progress.completed,
        scheduled: progress.scheduled || Boolean(previous?.scheduled),
        excused: progress.excused || Boolean(previous?.excused),
      });
    }
    const scheduled = [...periods.values()].filter((period) => period.scheduled && !period.excused);
    const completed = scheduled.filter((period) => period.completed).length;
    const historicalHabit = recordAt(habit, history, reviewInstant) ?? habit;
    habitSummaries.push({
      habitId: habit.id,
      name: historicalHabit.name,
      completedPeriods: completed,
      scheduledPeriods: scheduled.length,
      compliance: scheduled.length ? completed / scheduled.length : null,
    });
    if (scheduled.length > 0 && completed === scheduled.length)
      completedHabits.push(historicalHabit);
  }
  return {
    weekStart: start,
    weekEnd: end,
    totalMinutes,
    activityCount: activities.length,
    activities: [...activities].sort((a, b) =>
      (b.occurredAt ?? b.createdAt).localeCompare(a.occurredAt ?? a.createdAt),
    ),
    completedHabits,
    habitSummaries,
    projectsWithProgress: records.filter(
      (record) => record.type === 'projects' && projectIds.has(record.id),
    ),
    goalsAttended: records.filter((record) => record.type === 'goals' && goalIds.has(record.id)),
    unattendedAreas: records
      .filter((record) => record.type === 'areas')
      .map((area) => recordAt(area, history, reviewInstant))
      .filter(
        (area): area is FaroRecord =>
          area !== null && area.status === 'active' && !areaIds.has(area.id),
      ),
    previousMinutes,
    minutesChange: totalMinutes - previousMinutes,
    activityChange: activities.length - previousActivities.length,
  };
}
