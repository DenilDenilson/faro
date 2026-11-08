import type { FaroRecord, HistoryEntry, Settings } from '../../lib/types';
import {
  addDays,
  dateKey,
  dayInstant,
  dayRange,
  daysBetween,
  endOfDay,
  endOfMonth,
  isActivity,
  recordDate,
  startOfMonth,
  startOfWeek,
  weekday,
} from '../analytics/dates';
import { activeDaysBetween, recordAt } from '../seasons';

export interface HabitPeriod {
  periodStart: string;
  periodEnd: string;
  sessions: number;
  minutes: number;
  targetCount: number | null;
  targetMinutes: number | null;
  progress: number | null;
  completed: boolean;
  scheduled: boolean;
  paused: boolean;
  excused: boolean;
  eligibleDays: number;
  open: boolean;
}

export interface HabitProgress extends HabitPeriod {
  habitId: string;
  streak: number | null;
  history: HabitPeriod[];
}

interface EvaluationContext {
  settings: Settings;
  history: HistoryEntry[];
  timestamps: number[];
  minuteTotals: number[];
  createdDay: string;
  hasStateChanges: boolean;
}

/** Sort once per habit; each period subsequently queries two binary-search bounds. */
function evaluationContext(
  habit: FaroRecord,
  records: FaroRecord[],
  settings: Settings,
  history: HistoryEntry[],
): EvaluationContext {
  const activities = records
    .filter((record) => isActivity(record) && record.habitIds?.includes(habit.id))
    .map((record) => ({
      timestamp: Date.parse(record.occurredAt ?? record.createdAt),
      minutes: record.durationMinutes ?? 0,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
  const minuteTotals = [0];
  for (const activity of activities)
    minuteTotals.push((minuteTotals.at(-1) ?? 0) + activity.minutes);
  const changes = history
    .filter((entry) => entry.recordId === habit.id)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return {
    settings,
    history: changes,
    timestamps: activities.map((activity) => activity.timestamp),
    minuteTotals,
    createdDay: dateKey(habit.createdAt, settings.timezone),
    hasStateChanges: changes.some(
      (entry) => entry.before !== null && entry.before.status !== entry.after?.status,
    ),
  };
}

function lowerBound(values: number[], target: number, inclusive = false): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((values[middle] ?? Infinity) < target || (inclusive && values[middle] === target))
      low = middle + 1;
    else high = middle;
  }
  return low;
}

function periodFor(habit: FaroRecord, day: string, timezone: string): [string, string] {
  switch (habit.cadence ?? 'daily') {
    case 'weekly':
      return [startOfWeek(day), addDays(startOfWeek(day), 6)];
    case 'monthly':
      return [startOfMonth(day), endOfMonth(day)];
    case 'interval': {
      const anchor = habit.startDate ?? dateKey(habit.createdAt, timezone);
      const interval = Math.max(1, habit.intervalDays ?? 1);
      const bucket = Math.floor(daysBetween(anchor, day) / interval);
      const start = addDays(anchor, bucket * interval);
      return [start, addDays(start, interval - 1)];
    }
    case 'custom':
      return [startOfWeek(day), addDays(startOfWeek(day), 6)];
    default:
      return [day, day];
  }
}

function evaluatePeriod(
  habit: FaroRecord,
  context: EvaluationContext,
  day: string,
  until: Date,
): HabitPeriod {
  const { settings, history } = context;
  const [periodStart, periodEnd] = periodFor(habit, day, settings.timezone);
  const customDays = habit.weekdays?.length ? habit.weekdays : [1, 2, 3, 4, 5];
  const scheduledDays = dayRange(periodStart, periodEnd).filter(
    (candidate) =>
      (habit.cadence !== 'custom' || customDays.includes(weekday(candidate) % 7)) &&
      candidate >= (habit.startDate ?? context.createdDay) &&
      (!habit.endDate || candidate <= habit.endDate),
  );
  const paused = ['paused', 'archived', 'cancelled', 'completed'].includes(habit.status);
  const eligibleDays = context.hasStateChanges
    ? scheduledDays.filter((candidate) => {
        const configuration = recordAt(habit, history, endOfDay(candidate, settings.timezone));
        return (
          configuration !== null &&
          !['paused', 'archived', 'cancelled', 'completed'].includes(configuration.status)
        );
      }).length
    : paused
      ? 0
      : scheduledDays.length;
  const scheduled = scheduledDays.includes(day) && !paused;
  const periodEndInstant = endOfDay(periodEnd, settings.timezone).getTime();
  const first = lowerBound(
    context.timestamps,
    dayInstant(periodStart, settings.timezone).getTime(),
  );
  const last = lowerBound(context.timestamps, Math.min(until.getTime(), periodEndInstant), true);
  const sessions = Math.max(0, last - first);
  const minutes = (context.minuteTotals[last] ?? 0) - (context.minuteTotals[first] ?? 0);
  const durationMode = (habit.targetMinutes ?? 0) > 0;
  const targetCount = durationMode
    ? null
    : Math.max(1, habit.targetCount ?? (habit.cadence === 'custom' ? customDays.length : 1));
  const targetMinutes = durationMode ? (habit.targetMinutes ?? null) : null;
  const target = targetMinutes ?? targetCount ?? 1;
  const value = durationMode ? minutes : sessions;
  const completed = value >= target;
  const hasPause =
    eligibleDays < scheduledDays.length ||
    (context.hasStateChanges &&
      activeDaysBetween(habit, history, periodStart, addDays(periodEnd, 1), settings.timezone) <
        daysBetween(periodStart, addDays(periodEnd, 1)));
  // A pause excuses an incomplete period rather than silently inventing a lower target.
  const excused = !completed && (paused || hasPause || scheduledDays.length === 0);
  return {
    periodStart,
    periodEnd,
    sessions,
    minutes,
    targetCount,
    targetMinutes,
    progress: paused || scheduledDays.length === 0 ? null : Math.min(1, value / target),
    completed,
    scheduled,
    paused,
    excused,
    eligibleDays,
    open: until.getTime() < periodEndInstant,
  };
}

function collectPeriods(
  habit: FaroRecord,
  context: EvaluationContext,
  startDate: string,
  endDate: string,
  now: Date,
  limit = Infinity,
): HabitPeriod[] {
  const today = dateKey(now, context.settings.timezone);
  let cursor = endDate < today ? endDate : today;
  const periods: HabitPeriod[] = [];
  while (cursor >= startDate && cursor >= context.createdDay && periods.length < limit) {
    const until = cursor === today ? now : endOfDay(cursor, context.settings.timezone);
    const configuration = recordAt(habit, context.history, until);
    if (!configuration) break;
    const period = evaluatePeriod(configuration, context, cursor, until);
    periods.push(period);
    cursor = addDays(period.periodStart, -1);
  }
  return periods;
}

/** Complete date-range compliance, independent of the twelve-period UI preview. */
export function habitPeriods(
  habit: FaroRecord,
  records: FaroRecord[],
  settings: Settings,
  startDate: string,
  endDate: string,
  now = new Date(),
  history: HistoryEntry[] = [],
): HabitPeriod[] {
  const context = evaluationContext(habit, records, settings, history);
  return collectPeriods(habit, context, startDate, endDate, now).reverse();
}

export function habitProgress(
  habit: FaroRecord,
  records: FaroRecord[],
  settings: Settings,
  now = new Date(),
  history: HistoryEntry[] = [],
): HabitProgress {
  const context = evaluationContext(habit, records, settings, history);
  const today = dateKey(now, settings.timezone);
  const configuration = recordAt(habit, context.history, now) ?? habit;
  const current = evaluatePeriod(configuration, context, today, now);
  const periods = collectPeriods(
    habit,
    context,
    context.createdDay,
    addDays(current.periodStart, -1),
    now,
    12,
  );
  let streak = current.completed ? 1 : 0;
  const streakPeriods = settings.showStreaks
    ? collectPeriods(habit, context, context.createdDay, addDays(current.periodStart, -1), now)
    : periods;
  for (const period of streakPeriods) {
    if (period.excused) continue;
    if (!period.completed) break;
    streak++;
  }
  return {
    ...current,
    habitId: habit.id,
    streak: settings.showStreaks ? streak : null,
    history: periods,
  };
}

export function habitCalendar(
  habit: FaroRecord,
  records: FaroRecord[],
  settings: Settings,
  startDate: string,
  endDate: string,
  now = new Date(),
): { date: string; sessions: number; minutes: number }[] {
  const sessions = records.filter(
    (record) =>
      isActivity(record) &&
      record.habitIds?.includes(habit.id) &&
      (record.occurredAt ?? record.createdAt) <= now.toISOString(),
  );
  const byDay = new Map<string, { sessions: number; minutes: number }>();
  for (const session of sessions) {
    const day = recordDate(session, settings.timezone);
    const current = byDay.get(day) ?? { sessions: 0, minutes: 0 };
    current.sessions++;
    current.minutes += session.durationMinutes ?? 0;
    byDay.set(day, current);
  }
  return dayRange(startDate, endDate).map((date) => {
    return { date, ...(byDay.get(date) ?? { sessions: 0, minutes: 0 }) };
  });
}
