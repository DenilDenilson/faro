import type { AlertType, FaroRecord, HistoryEntry, Settings } from '../../lib/types';
import { attentionFor } from '../attention';
import { habitProgress } from '../habits';
import { activeDaysBetween } from '../seasons';
import {
  addDays,
  dateKey,
  daysBetween,
  isActivity,
  recordDate,
  startOfWeek,
} from '../analytics/dates';

export interface FaroAlert {
  id: string;
  type: AlertType;
  recordId?: string;
  title: string;
  message: string;
  href: string;
  severity: 'info' | 'warning';
  createdFor: string;
}

function latestSession(
  record: FaroRecord,
  activities: FaroRecord[],
  type: 'interests' | 'projects',
): string | undefined {
  const matching = activities.filter((activity) =>
    (type === 'interests' ? activity.interestIds : activity.projectIds)?.includes(record.id),
  );
  return matching
    .map((activity) => activity.occurredAt ?? activity.createdAt)
    .sort()
    .at(-1);
}

function latestProjectActivity(
  project: FaroRecord,
  records: FaroRecord[],
  activities: FaroRecord[],
  history: HistoryEntry[],
  now: Date,
): string {
  const timestamps = [project.createdAt, latestSession(project, activities, 'projects')].filter(
    (value): value is string => Boolean(value),
  );
  for (const record of records) {
    if (record.parentId !== project.id || record.status === 'cancelled') continue;
    if (record.type === 'progress') timestamps.push(record.occurredAt ?? record.createdAt);
    if (record.type === 'milestones' && record.status === 'completed') {
      const completion = history
        .filter(
          (entry) =>
            entry.recordId === record.id &&
            entry.after?.status === 'completed' &&
            entry.before?.status !== 'completed',
        )
        .map((entry) => entry.occurredAt)
        .sort()
        .at(-1);
      timestamps.push(record.completedAt ?? completion ?? record.updatedAt);
    }
  }
  // Explicitly resuming work starts a fresh grace window; paused time never creates a reminder debt.
  for (const change of history) {
    if (change.recordId !== project.id || !change.before || !change.after) continue;
    if (
      ['paused', 'archived'].includes(change.before.status) &&
      ['active', 'in_progress', 'pending'].includes(change.after.status)
    )
      timestamps.push(change.occurredAt);
  }
  return (
    timestamps
      .filter((timestamp) => timestamp <= now.toISOString())
      .sort()
      .at(-1) ?? project.createdAt
  );
}

/** Derived alerts have stable condition/period IDs; snoozing does not create copies. */
export function buildAlerts(
  records: FaroRecord[],
  settings: Settings,
  now: Date = new Date(),
  history: HistoryEntry[] = [],
): FaroAlert[] {
  const today = dateKey(now, settings.timezone);
  const activities = records.filter(
    (record) => isActivity(record) && (record.occurredAt ?? record.createdAt) <= now.toISOString(),
  );
  const alerts: FaroAlert[] = [];
  for (const record of records) {
    if (
      record.status === 'paused' ||
      record.status === 'archived' ||
      record.status === 'cancelled' ||
      record.status === 'completed'
    )
      continue;
    if (record.type === 'interests' && settings.alertPreferences.interest) {
      const attention = attentionFor(record, records, settings, now, history);
      if (attention.state !== 'neglected') continue;
      const last = latestSession(record, activities, 'interests') ?? record.createdAt;
      alerts.push({
        id: `interest:${record.id}:${last}`,
        type: 'interest',
        recordId: record.id,
        title: `${record.name} necesita atención`,
        message: attention.reason,
        href: `/interests?id=${encodeURIComponent(record.id)}`,
        severity: 'warning',
        createdFor: dateKey(last, settings.timezone),
      });
    }
    if (record.type === 'habits' && settings.alertPreferences.habit) {
      const progress = habitProgress(record, records, settings, now, history);
      if (progress.paused || !progress.scheduled || progress.completed) continue;
      alerts.push({
        id: `habit:${record.id}:${progress.periodStart}`,
        type: 'habit',
        recordId: record.id,
        title: `${record.name}: período pendiente`,
        message:
          progress.targetMinutes != null
            ? `${progress.minutes} de ${progress.targetMinutes} minutos en este período.`
            : `${progress.sessions} de ${progress.targetCount ?? 1} sesiones en este período.`,
        href: `/habits?id=${encodeURIComponent(record.id)}`,
        severity: 'info',
        createdFor: progress.periodStart,
      });
    }
    if (record.type === 'goals' && settings.alertPreferences.goal && record.endDate) {
      const dueDay = record.endDate.slice(0, 10);
      const remaining = daysBetween(today, dueDay);
      if (remaining > settings.goalDueDays) continue;
      alerts.push({
        id: `goal:${record.id}:${dueDay}`,
        type: 'goal',
        recordId: record.id,
        title: remaining < 0 ? `${record.name}: fecha superada` : `${record.name}: fecha próxima`,
        message:
          remaining < 0
            ? `La fecha objetivo fue hace ${Math.abs(remaining)} días.`
            : `Quedan ${remaining} días hasta la fecha objetivo.`,
        href: `/goals?id=${encodeURIComponent(record.id)}`,
        severity: remaining < 0 ? 'warning' : 'info',
        createdFor: dueDay,
      });
    }
    if (record.type === 'projects' && settings.alertPreferences.project) {
      const last = latestProjectActivity(record, records, activities, history, now);
      const inactiveDays = activeDaysBetween(
        record,
        history,
        dateKey(last, settings.timezone),
        today,
        settings.timezone,
      );
      if (inactiveDays < settings.projectIdleDays) continue;
      alerts.push({
        id: `project:${record.id}:${last}`,
        type: 'project',
        recordId: record.id,
        title: `${record.name}: retoma el hilo`,
        message: `${inactiveDays} días activos sin una sesión o avance registrado. Puedes retomarlo o pausarlo.`,
        href: `/projects?id=${encodeURIComponent(record.id)}`,
        severity: 'info',
        createdFor: dateKey(last, settings.timezone),
      });
    }
  }
  if (settings.alertPreferences.review) {
    const previousWeek = addDays(startOfWeek(today), -7);
    const reviewed = records.some(
      (record) => record.type === 'reviews' && record.weekStart === previousWeek,
    );
    const hasEarlierData = records.some(
      (record) =>
        record.type !== 'reviews' && recordDate(record, settings.timezone) < startOfWeek(today),
    );
    if (!reviewed && hasEarlierData)
      alerts.push({
        id: `review:${previousWeek}`,
        type: 'review',
        title: 'Tu revisión semanal está pendiente',
        message: `Revisa la semana del ${previousWeek} y decide qué quieres cultivar después.`,
        href: `/reviews?week=${previousWeek}`,
        severity: 'info',
        createdFor: previousWeek,
      });
  }
  return alerts
    .filter((alert) => {
      if (settings.dismissedAlerts[alert.id]) return false;
      const snoozed = settings.snoozedAlerts[alert.id];
      if (snoozed && Number.isFinite(Date.parse(snoozed)) && Date.parse(snoozed) > now.getTime())
        return false;
      return true;
    })
    .sort((a, b) =>
      a.severity === b.severity ? a.id.localeCompare(b.id) : a.severity === 'warning' ? -1 : 1,
    );
}
