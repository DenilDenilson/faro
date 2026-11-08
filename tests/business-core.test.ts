import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type FaroRecord, type HistoryEntry } from '../src/lib/types';
import { attentionFor } from '../src/domains/attention';
import {
  allocatedMinutesForArea,
  allocatedMinutesForInterest,
  buildAnalytics,
  goalMetric,
} from '../src/domains/analytics';
import {
  dateKey,
  dayInstant,
  daysBetween,
  endOfDay,
  startOfWeek,
} from '../src/domains/analytics/dates';
import { habitCalendar, habitPeriods, habitProgress } from '../src/domains/habits';
import { activeDaysBetween, recordAt, seasonRoleFor } from '../src/domains/seasons';

const settings = { ...DEFAULT_SETTINGS };
const now = new Date('2026-11-08T18:00:00.000Z');
function record(
  id: string,
  type: FaroRecord['type'],
  fields: Partial<FaroRecord> = {},
): FaroRecord {
  return {
    id,
    type,
    name: id,
    description: '',
    status: 'active',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...fields,
  };
}
function session(id: string, occurredAt: string, fields: Partial<FaroRecord> = {}): FaroRecord {
  return record(id, 'activities', { occurredAt, durationMinutes: 60, ...fields });
}
function change(before: FaroRecord, after: FaroRecord, occurredAt: string): HistoryEntry {
  return {
    id: `${before.id}-${occurredAt}`,
    recordId: before.id,
    type: before.type,
    operation: 'update',
    before,
    after,
    occurredAt,
  };
}

describe('calendar dates', () => {
  it('uses Lima day boundaries rather than server UTC dates', () => {
    expect(dateKey('2026-11-09T02:00:00Z', 'America/Lima')).toBe('2026-11-08');
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02');
  });
  it('resolves DST days without assuming every calendar day is 24 hours', () => {
    const start = dayInstant('2026-03-08', 'America/New_York');
    const end = endOfDay('2026-03-08', 'America/New_York');
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(end.getTime() - start.getTime() + 1).toBe(23 * 60 * 60 * 1000);
    expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1);
  });
});

describe('personal attention frequencies and historical states', () => {
  it('evaluates each interest using its own desired interval', () => {
    const weekly = record('weekly', 'interests', { frequencyDays: 7 });
    const monthly = record('monthly', 'interests', { frequencyDays: 30 });
    const sessions = [
      session('w', '2026-10-29T15:00:00Z', { interestIds: ['weekly'] }),
      session('m', '2026-10-29T15:00:00Z', { interestIds: ['monthly'] }),
    ];
    expect(attentionFor(weekly, sessions, settings, now).state).toBe('neglected');
    expect(attentionFor(monthly, sessions, settings, now).state).toBe('current');
  });
  it('gives a new interest a documented no-data grace period', () => {
    const fresh = record('new', 'interests', {
      frequencyDays: 14,
      createdAt: '2026-11-07T12:00:00Z',
    });
    expect(attentionFor(fresh, [], settings, now).state).toBe('insufficient');
    expect(
      attentionFor({ ...fresh, createdAt: '2026-10-01T12:00:00Z' }, [], settings, now).state,
    ).toBe('neglected');
  });
  it('excludes paused days and does not penalize paused interests', () => {
    const initial = record('robotics', 'interests', { frequencyDays: 7 });
    const paused = { ...initial, status: 'paused' as const };
    const resumed = { ...initial, updatedAt: '2026-11-07T12:00:00Z' };
    const history = [
      change(initial, paused, '2026-11-02T12:00:00Z'),
      change(paused, resumed, '2026-11-07T12:00:00Z'),
    ];
    expect(activeDaysBetween(resumed, history, '2026-11-01', '2026-11-08', 'America/Lima')).toBe(2);
    expect(
      attentionFor(
        resumed,
        [session('s', '2026-11-01T12:00:00Z', { interestIds: ['robotics'] })],
        settings,
        now,
        history,
      ).state,
    ).toBe('current');
    expect(attentionFor(paused, [], settings, now).state).toBe('paused');
  });
  it('reconstructs prior frequency and starts a fresh window after a frequency edit', () => {
    const initial = record('french', 'interests', { frequencyDays: 30 });
    const edited = { ...initial, frequencyDays: 2, updatedAt: '2026-11-08T12:00:00Z' };
    const history = [change(initial, edited, edited.updatedAt)];
    expect(recordAt(edited, history, new Date('2026-11-07T18:00:00Z'))?.frequencyDays).toBe(30);
    expect(attentionFor(edited, [], settings, now, history).state).toBe('insufficient');
  });
  it('uses priority and active season to bring forward the warning, without changing the due interval', () => {
    const interest = record('english', 'interests', { frequencyDays: 10, priority: 3 });
    const season = record('masters', 'seasons', {
      startDate: '2026-11-01',
      endDate: '2026-12-31',
      focusIds: ['english'],
    });
    const result = attentionFor(
      interest,
      [season, session('s', '2026-11-01T12:00:00Z', { interestIds: ['english'] })],
      settings,
      now,
    );
    expect(result.seasonRole).toBe('focus');
    expect(result.frequencyDays).toBe(10);
    expect(result.state).toBe('due');
  });
  it('lets an explicit interest season role override the broader area focus', () => {
    const interest = record('music', 'interests', { areaId: 'culture' });
    const season = record('season', 'seasons', {
      startDate: '2026-11-01',
      endDate: '2026-12-31',
      focusIds: ['culture'],
      explorationIds: ['music'],
    });
    expect(seasonRoleFor(interest, [season], '2026-11-08')).toBe('exploration');
  });
  it('respects configurable warning ratios at their validated boundaries', () => {
    const interest = record('ratio', 'interests', { frequencyDays: 30, priority: 2 });
    const sessions = [session('s', '2026-10-20T12:00:00Z', { interestIds: ['ratio'] })];
    expect(
      attentionFor(interest, sessions, { ...settings, attentionWarningRatio: 1 }, now).warningDays,
    ).toBe(30);
    expect(
      attentionFor(interest, sessions, { ...settings, attentionWarningRatio: 0.1 }, now)
        .warningDays,
    ).toBe(3);
  });
});

describe('habit periods', () => {
  it('supports weekly session targets and counts one linked activity once', () => {
    const habit = record('study', 'habits', { cadence: 'weekly', targetCount: 2 });
    const sessions = [
      session('a', '2026-11-03T12:00:00Z', {
        habitIds: ['study', 'study'],
        interestIds: ['a', 'b'],
      }),
      session('b', '2026-11-06T12:00:00Z', { habitIds: ['study'] }),
    ];
    const progress = habitProgress(habit, sessions, settings, now);
    expect(progress.periodStart).toBe('2026-11-02');
    expect(progress.sessions).toBe(2);
    expect(progress.completed).toBe(true);
    expect(progress.minutes).toBe(120);
  });
  it('supports duration mode independently from session count', () => {
    const habit = record('run', 'habits', {
      cadence: 'monthly',
      targetMinutes: 100,
      targetCount: 10,
    });
    const progress = habitProgress(
      habit,
      [session('a', '2026-11-03T12:00:00Z', { habitIds: ['run'], durationMinutes: 120 })],
      settings,
      now,
    );
    expect(progress.targetCount).toBeNull();
    expect(progress.completed).toBe(true);
    expect(progress.periodEnd).toBe('2026-11-30');
  });
  it('anchors every-N-days windows to the configured start, including before today', () => {
    const habit = record('water', 'habits', {
      cadence: 'interval',
      intervalDays: 3,
      startDate: '2026-11-01',
    });
    const progress = habitProgress(habit, [], settings, now);
    expect(progress.periodStart).toBe('2026-11-07');
    expect(progress.periodEnd).toBe('2026-11-09');
  });
  it('supports selected weekdays, pauses without penalties, and optional streaks', () => {
    const habit = record('gym', 'habits', {
      cadence: 'custom',
      weekdays: [1, 3, 5],
      targetCount: 3,
    });
    expect(habitProgress(habit, [], settings, now).scheduled).toBe(false);
    const paused = habitProgress({ ...habit, status: 'paused' }, [], settings, now);
    expect(paused.excused).toBe(true);
    expect(paused.progress).toBeNull();
    expect(paused.streak).toBeNull();
  });
  it('recognizes Sunday=0 from the saved form/schema weekday convention', () => {
    const habit = record('sunday', 'habits', { cadence: 'custom', weekdays: [0], targetCount: 1 });
    expect(habitProgress(habit, [], settings, now).scheduled).toBe(true);
    expect(habitProgress(habit, [], settings, new Date('2026-11-07T18:00:00Z')).scheduled).toBe(
      false,
    );
  });
  it('excludes future sessions from the practice calendar as well as current progress', () => {
    const habit = record('calendar', 'habits', { cadence: 'daily', targetCount: 1 });
    const sessions = [
      session('past', '2026-11-08T12:00:00Z', { habitIds: ['calendar'] }),
      session('later', '2026-11-08T22:00:00Z', { habitIds: ['calendar'] }),
    ];
    expect(habitCalendar(habit, sessions, settings, '2026-11-08', '2026-11-08', now)[0]).toEqual({
      date: '2026-11-08',
      sessions: 1,
      minutes: 60,
    });
  });
  it('uses audited prior targets and enumerates more than twelve days for analytics', () => {
    const old = record('daily', 'habits', { cadence: 'daily', targetCount: 1 });
    const updated = { ...old, targetCount: 3, updatedAt: '2026-11-08T12:00:00Z' };
    const history = [change(old, updated, updated.updatedAt)];
    const progress = habitProgress(
      updated,
      [session('s', '2026-11-07T12:00:00Z', { habitIds: ['daily'] })],
      settings,
      now,
      history,
    );
    expect(progress.history[0]?.targetCount).toBe(1);
    expect(progress.history[0]?.completed).toBe(true);
    expect(
      habitPeriods(updated, [], settings, '2026-10-01', '2026-11-08', now, history).length,
    ).toBe(39);
  });
  it('does not truncate an enabled streak to its twelve-period display history', () => {
    const habit = record('long-streak', 'habits', {
      cadence: 'daily',
      targetCount: 1,
      createdAt: '2026-10-20T12:00:00Z',
    });
    const sessions = Array.from({ length: 20 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 9, 20 + index, 12)).toISOString();
      return session(`streak-${index}`, day, { habitIds: ['long-streak'] });
    });
    const progress = habitProgress(habit, sessions, { ...settings, showStreaks: true }, now);
    expect(progress.history).toHaveLength(12);
    expect(progress.streak).toBe(20);
  });
});

describe('conserved statistics and explicit progress', () => {
  const records = [
    record('tech', 'areas'),
    record('health', 'areas'),
    record('robotics', 'interests', { areaId: 'tech' }),
    record('run', 'interests', { areaId: 'health' }),
    session('shared', '2026-11-07T12:00:00Z', {
      durationMinutes: 100,
      interestIds: ['robotics', 'run'],
      projectIds: ['p1', 'p2'],
      goalIds: ['goal'],
    }),
  ];
  it('conserves total time across multiple interests, areas and projects', () => {
    const stats = buildAnalytics(records, settings, {}, now);
    expect(stats.totalMinutes).toBe(100);
    expect(stats.sessionCount).toBe(1);
    expect(stats.byInterest.map((row) => row.minutes)).toEqual([50, 50]);
    expect(stats.byArea.reduce((sum, row) => sum + row.minutes, 0)).toBe(100);
    expect(stats.byProject.reduce((sum, row) => sum + row.minutes, 0)).toBe(100);
    expect(stats.daily.reduce((sum, row) => sum + row.minutes, 0)).toBe(100);
  });
  it('filters allocated interest shares while preserving unique session counts', () => {
    const stats = buildAnalytics(records, settings, { interestId: 'robotics' }, now);
    expect(stats.totalMinutes).toBe(50);
    expect(stats.sessionCount).toBe(1);
    expect(stats.byArea[0]?.id).toBe('tech');
    expect(allocatedMinutesForInterest('robotics', records, now)).toBe(50);
    expect(allocatedMinutesForArea('tech', records, now)).toBe(50);
  });
  it('preserves the original area of a session after moving its interest', () => {
    const old = record('robotics', 'interests', { areaId: 'tech' });
    const moved = { ...old, areaId: 'health', updatedAt: '2026-11-08T12:00:00Z' };
    const history = [change(old, moved, moved.updatedAt)];
    const current = records.map((item) => (item.id === moved.id ? moved : item));
    expect(buildAnalytics(current, settings, { areaId: 'tech' }, now, history).totalMinutes).toBe(
      50,
    );
    expect(allocatedMinutesForArea('tech', current, now, history)).toBe(50);
    expect(allocatedMinutesForArea('health', current, now, history)).toBe(50);
  });
  it('compares equally sized preceding calendar periods and distinguishes missing data', () => {
    const stats = buildAnalytics(
      [...records, session('prior', '2026-11-01T12:00:00Z', { durationMinutes: 30 })],
      settings,
      { startDate: '2026-11-07', endDate: '2026-11-08' },
      now,
    );
    expect(stats.previousMinutes).toBe(0);
    expect(stats.deltaMinutes).toBe(100);
    expect(buildAnalytics([], settings, {}, now)).toMatchObject({
      hasData: false,
      totalMinutes: 0,
      sessionCount: 0,
    });
  });
  it('derives goal progress only from explicit measurements, never session time', () => {
    const goal = record('goal', 'goals', { targetValue: 10, currentValue: 2 });
    expect(goalMetric(goal, records, now).progress).toBe(0.2);
    expect(goalMetric(record('unknown', 'goals'), records, now).progress).toBeNull();
    expect(
      goalMetric(
        goal,
        [
          ...records,
          record('measurement', 'progress', {
            parentId: 'goal',
            value: 6,
            occurredAt: '2026-11-08T12:00:00Z',
          }),
        ],
        now,
      ).progress,
    ).toBe(0.6);
    expect(
      goalMetric(
        goal,
        [
          ...records,
          record('future-measurement', 'progress', {
            parentId: 'goal',
            value: 9,
            occurredAt: '2026-11-10T12:00:00Z',
          }),
        ],
        now,
      ).progress,
    ).toBe(0.2);
  });
  it('chooses the newest explicit measurement for equal occurredAt timestamps', () => {
    const goal = record('goal', 'goals', { targetValue: 10 });
    const newer = record('newer', 'progress', {
      parentId: 'goal',
      value: 8,
      occurredAt: '2026-11-07T12:00:00Z',
      createdAt: '2026-11-07T14:00:00Z',
    });
    const older = record('older', 'progress', {
      parentId: 'goal',
      value: 2,
      occurredAt: '2026-11-07T12:00:00Z',
      createdAt: '2026-11-07T13:00:00Z',
    });
    expect(goalMetric(goal, [newer, older], now).currentValue).toBe(8);
  });
});
