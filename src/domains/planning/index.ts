import { goalMetric, projectMetric } from '../analytics';
import type { FaroSnapshot } from '../../lib/types';
import { metadataSnapshot, compactRecord } from '../data/views';
import { addDays, dateKey, endOfDay, isActivity, recordDate } from '../analytics/dates';
import { attentionRadar } from '../attention';
import { habitPeriods } from '../habits';
import type { PlanningItem, WeekPlan } from './types';

export function weeklyRhythms(snapshot: FaroSnapshot, weekStart: string, plans: WeekPlan[]) {
  const records = snapshot.records.filter(
    (r) => !isActivity(r) || (r.occurredAt ?? r.createdAt) <= snapshot.generatedAt,
  );
  return records
    .filter(
      (r) => r.type === 'habits' && !['archived', 'cancelled', 'completed'].includes(r.status),
    )
    .map((habit) => {
      const periods = habitPeriods(
        habit,
        records,
        snapshot.settings,
        weekStart,
        addDays(weekStart, 6),
        endOfDay(addDays(weekStart, 6), snapshot.settings.timezone),
        snapshot.history,
      );
      const eligible = periods.filter((p) => p.eligibleDays > 0);
      const minutes = Boolean(habit.targetMinutes);
      const done = eligible.reduce((n, p) => n + (minutes ? p.minutes : p.sessions), 0);
      const target = eligible.reduce(
        (n, p) => n + (minutes ? (p.targetMinutes ?? 0) : (p.targetCount ?? 0)),
        0,
      );
      const planned = plans.filter((p) => p.status === 'pending' && p.habitIds?.includes(habit.id));
      const plannedValue = minutes
        ? planned.reduce((n, p) => n + (p.estimatedMinutes ?? 0), 0)
        : planned.length;
      const excused =
        habit.status === 'paused' || !eligible.length || eligible.every((p) => p.excused);
      return {
        habit: compactRecord(habit, 0),
        done,
        target,
        minutes,
        planned: planned.length,
        plannedValue,
        remaining: excused ? 0 : Math.max(0, target - done - plannedValue),
        excused,
        periodLabel:
          habit.cadence === 'monthly'
            ? 'Período mensual'
            : habit.cadence === 'interval'
              ? 'Períodos del intervalo'
              : 'Esta semana',
      };
    });
}
export function planningView(snapshot: FaroSnapshot, items: PlanningItem[], weekStart: string) {
  const plans = items.filter((p): p is WeekPlan => p.kind === 'plan' && p.weekStart === weekStart);
  const end = addDays(weekStart, 6);
  const activities = snapshot.records
    .filter(
      (r) =>
        isActivity(r) &&
        (r.occurredAt ?? r.createdAt) <= snapshot.generatedAt &&
        recordDate(r, snapshot.settings.timezone) >= weekStart &&
        recordDate(r, snapshot.settings.timezone) <= end,
    )
    .map((r) => compactRecord(r));
  const attention = attentionRadar(
    snapshot.records,
    snapshot.settings,
    new Date(snapshot.generatedAt),
    snapshot.history,
  ).map((attention) => ({
    interest: compactRecord(snapshot.records.find((r) => r.id === attention.interestId)!),
    attention,
  }));
  return {
    openWork: snapshot.records
      .filter(
        (r) =>
          ['goals', 'projects'].includes(r.type) &&
          ['pending', 'active', 'in_progress'].includes(r.status),
      )
      .sort(
        (a, b) =>
          (b.priority ?? 0) - (a.priority ?? 0) ||
          (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999') ||
          a.name.localeCompare(b.name, 'es'),
      )
      .map((record) => ({
        record: { ...compactRecord(record), purpose: record.purpose?.slice(0, 200) },
        progress:
          record.type === 'goals'
            ? goalMetric(record, snapshot.records, new Date(snapshot.generatedAt)).progress
            : projectMetric(record, snapshot.records).progress,
        nextMilestone:
          record.type === 'projects'
            ? snapshot.records
                .filter(
                  (r) =>
                    r.type === 'milestones' &&
                    r.parentId === record.id &&
                    ['pending', 'active', 'in_progress'].includes(r.status),
                )
                .sort(
                  (a, b) =>
                    (a.order ?? 0) - (b.order ?? 0) ||
                    (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999') ||
                    a.name.localeCompare(b.name, 'es'),
                )
                .map((r) => ({ id: r.id, name: r.name }))[0]
            : undefined,
      })),
    weekStart,
    today: dateKey(snapshot.generatedAt, snapshot.settings.timezone),
    snapshot: metadataSnapshot(snapshot),
    plans,
    previousPlans: items.filter(
      (p): p is WeekPlan =>
        p.kind === 'plan' && p.weekStart === addDays(weekStart, -7) && p.status === 'pending',
    ),
    templates: items
      .filter((p) => p.kind === 'template')
      .map((t) => ({ id: t.id, name: t.name, slotCount: t.slots.length })),
    activities,
    rhythms: weeklyRhythms(snapshot, weekStart, plans),
    attention,
    reviewId: snapshot.records.find((r) => r.type === 'reviews' && r.weekStart === weekStart)?.id,
    previousReviewId: snapshot.records.find(
      (r) => r.type === 'reviews' && r.weekStart === addDays(weekStart, -7),
    )?.id,
  };
}
export type PlanningView = ReturnType<typeof planningView>;
