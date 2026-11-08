import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type FaroRecord,
  type HistoryEntry,
  type Settings,
} from '../src/lib/types';
import { weeklySummary } from '../src/domains/reviews';
import { buildAlerts } from '../src/domains/notifications';
import { buildTimeline } from '../src/domains/timeline';

const now = new Date('2026-11-08T18:00:00.000Z');
const settings = (override: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  dismissedAlerts: {},
  snoozedAlerts: {},
  ...override,
});
function record(type: FaroRecord['type'], id: string, extra: Partial<FaroRecord> = {}): FaroRecord {
  return {
    id,
    type,
    name: id,
    description: '',
    status: 'active',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...extra,
  };
}

describe('weekly summaries', () => {
  it('counts a session once even when several interests, areas and goals are linked', () => {
    const records = [
      record('areas', 'technology'),
      record('areas', 'health'),
      record('areas', 'relationships'),
      record('interests', 'robotics', { areaId: 'technology' }),
      record('interests', 'running', { areaId: 'health' }),
      record('goals', 'goal'),
      record('projects', 'project'),
      record('activities', 'current', {
        occurredAt: '2026-11-05T12:00:00Z',
        durationMinutes: 60,
        interestIds: ['robotics', 'running'],
        projectIds: ['project'],
        goalIds: ['goal'],
      }),
      record('activities', 'previous', { occurredAt: '2026-10-28T12:00:00Z', durationMinutes: 30 }),
    ];
    const result = weeklySummary(records, settings(), '2026-11-02', now);
    expect(result.totalMinutes).toBe(60);
    expect(result.activityCount).toBe(1);
    expect(result.previousMinutes).toBe(30);
    expect(result.minutesChange).toBe(30);
    expect(result.unattendedAreas.map((area) => area.id)).toEqual(['relationships']);
    expect(result.projectsWithProgress.map((project) => project.id)).toEqual(['project']);
    expect(result.goalsAttended.map((goal) => goal.id)).toEqual(['goal']);
  });

  it('uses Lima calendar weeks and preserves archived historical sessions', () => {
    const session = record('activities', 'late-sunday', {
      status: 'archived',
      occurredAt: '2026-11-02T03:30:00Z',
      durationMinutes: 25,
    });
    expect(weeklySummary([session], settings(), '2026-11-02', now).totalMinutes).toBe(0);
    expect(weeklySummary([session], settings(), '2026-10-26', now).totalMinutes).toBe(25);
  });

  it('keeps a completed custom weekly habit visible on an unscheduled Sunday and excuses pauses', () => {
    const habit = record('habits', 'practice', {
      cadence: 'custom',
      weekdays: [1, 3],
      targetCount: 2,
    });
    const paused = record('habits', 'resting', { cadence: 'daily', status: 'paused' });
    const sessions = [
      record('activities', 'monday', {
        habitIds: ['practice'],
        occurredAt: '2026-11-03T03:00:00Z',
        durationMinutes: 20,
      }),
      record('activities', 'wednesday', {
        habitIds: ['practice'],
        occurredAt: '2026-11-05T03:00:00Z',
        durationMinutes: 20,
      }),
    ];
    const summary = weeklySummary([habit, paused, ...sessions], settings(), '2026-11-02', now);
    expect(summary.completedHabits.map((entry) => entry.id)).toEqual(['practice']);
    expect(summary.habitSummaries.find((entry) => entry.habitId === 'practice')?.compliance).toBe(
      1,
    );
    expect(
      summary.habitSummaries.find((entry) => entry.habitId === 'resting')?.compliance,
    ).toBeNull();
  });

  it('preserves past habit compliance and active areas after they are archived', () => {
    const habit = record('habits', 'practice', {
      cadence: 'weekly',
      targetCount: 1,
      status: 'archived',
      updatedAt: '2026-11-07T12:00:00Z',
    });
    const area = record('areas', 'health', {
      status: 'archived',
      updatedAt: '2026-11-07T12:00:00Z',
    });
    const session = record('activities', 'study', {
      habitIds: [habit.id],
      occurredAt: '2026-10-28T12:00:00Z',
      durationMinutes: 20,
    });
    const history: HistoryEntry[] = [habit, area].map((entry) => ({
      id: `archive-${entry.id}`,
      recordId: entry.id,
      type: entry.type,
      operation: 'update',
      occurredAt: '2026-11-07T12:00:00Z',
      before: { ...entry, status: 'active' },
      after: entry,
    }));
    const summary = weeklySummary([habit, area, session], settings(), '2026-10-26', now, history);
    expect(summary.completedHabits.map((entry) => entry.id)).toEqual(['practice']);
    expect(summary.habitSummaries[0]?.compliance).toBe(1);
    expect(summary.unattendedAreas.map((entry) => entry.id)).toEqual(['health']);
    expect(summary.unattendedAreas[0]?.status).toBe('active');
    expect(
      weeklySummary(
        [habit, area, session],
        settings(),
        '2026-11-09',
        new Date('2026-11-15T18:00:00Z'),
        history,
      ).unattendedAreas,
    ).toHaveLength(0);
  });

  it('keeps completion events in their original review after objectives and milestones are reopened', () => {
    const goal = record('goals', 'master', { status: 'active', updatedAt: '2026-11-07T12:00:00Z' });
    const project = record('projects', 'robot', {
      status: 'in_progress',
      updatedAt: '2026-11-07T12:00:00Z',
    });
    const milestone = record('milestones', 'sensor', {
      status: 'pending',
      parentId: project.id,
      updatedAt: '2026-11-07T12:00:00Z',
    });
    const history: HistoryEntry[] = [goal, milestone].flatMap((entry) => [
      {
        id: `complete-${entry.id}`,
        recordId: entry.id,
        type: entry.type,
        operation: 'update' as const,
        occurredAt: '2026-10-28T12:00:00Z',
        before: entry,
        after: { ...entry, status: 'completed' as const },
      },
      {
        id: `reopen-${entry.id}`,
        recordId: entry.id,
        type: entry.type,
        operation: 'update' as const,
        occurredAt: '2026-11-07T12:00:00Z',
        before: { ...entry, status: 'completed' as const },
        after: entry,
      },
    ]);
    const summary = weeklySummary(
      [goal, project, milestone],
      settings(),
      '2026-10-26',
      now,
      history,
    );
    expect(summary.goalsAttended.map((entry) => entry.id)).toEqual(['master']);
    expect(summary.projectsWithProgress.map((entry) => entry.id)).toEqual(['robot']);
  });

  it('attributes attended areas using the interest relationship at the session date', () => {
    const oldArea = record('areas', 'technology');
    const newArea = record('areas', 'knowledge');
    const interest = record('interests', 'robotics', {
      areaId: newArea.id,
      updatedAt: '2026-11-07T12:00:00Z',
    });
    const session = record('activities', 'study', {
      interestIds: [interest.id],
      occurredAt: '2026-10-28T12:00:00Z',
      durationMinutes: 20,
    });
    const history: HistoryEntry[] = [
      {
        id: 'move',
        recordId: interest.id,
        type: interest.type,
        operation: 'update',
        occurredAt: '2026-11-07T12:00:00Z',
        before: { ...interest, areaId: oldArea.id },
        after: interest,
      },
    ];
    const summary = weeklySummary(
      [oldArea, newArea, interest, session],
      settings(),
      '2026-10-26',
      now,
      history,
    );
    expect(summary.unattendedAreas.map((entry) => entry.id)).toEqual(['knowledge']);
  });

  it('attributes a completed milestone to its completion week instead of its creation week', () => {
    const project = record('projects', 'robot');
    const milestone = record('milestones', 'sensor', {
      parentId: project.id,
      status: 'completed',
      updatedAt: '2026-11-04T12:00:00Z',
    });
    expect(
      weeklySummary([project, milestone], settings(), '2026-11-02', now).projectsWithProgress.map(
        (entry) => entry.id,
      ),
    ).toEqual(['robot']);
  });
});

describe('derived notifications', () => {
  const interest = record('interests', 'english', { frequencyDays: 7 });
  const noReview = settings({
    alertPreferences: { interest: true, habit: false, review: false, goal: false, project: false },
  });

  it('keeps an unchanged condition ID stable across dates, supports dismissal and respects pause', () => {
    const first = buildAlerts([interest], noReview, now);
    const next = buildAlerts([interest], noReview, new Date('2026-11-09T18:00:00Z'));
    expect(first).toHaveLength(1);
    expect(first[0]?.id).toBe(next[0]?.id);
    const id = first[0]!.id;
    expect(
      buildAlerts([interest], { ...noReview, dismissedAlerts: { [id]: now.toISOString() } }, now),
    ).toHaveLength(0);
    expect(buildAlerts([{ ...interest, status: 'paused' }], noReview, now)).toHaveLength(0);
  });

  it('snoozes only until the selected instant and honors type preferences', () => {
    const alert = buildAlerts([interest], noReview, now)[0]!;
    const snoozed = { ...noReview, snoozedAlerts: { [alert.id]: '2026-11-09T18:00:00Z' } };
    expect(buildAlerts([interest], snoozed, now)).toHaveLength(0);
    expect(buildAlerts([interest], snoozed, new Date('2026-11-10T18:00:00Z'))).toHaveLength(1);
    expect(
      buildAlerts(
        [interest],
        settings({ alertPreferences: { ...noReview.alertPreferences, interest: false } }),
        now,
      ),
    ).toHaveLength(0);
  });

  it('does not ask a brand-new empty account to review an earlier week', () => {
    expect(buildAlerts([], settings(), now)).toHaveLength(0);
    const older = record('areas', 'health');
    expect(
      buildAlerts([older], settings(), now).filter((alert) => alert.type === 'review'),
    ).toHaveLength(1);
    const review = record('reviews', 'review', { weekStart: '2026-10-26' });
    expect(
      buildAlerts([older, review], settings(), now).filter((alert) => alert.type === 'review'),
    ).toHaveLength(0);
  });

  it('uses real progress and completed milestones as project activity, ignoring future entries', () => {
    const project = record('projects', 'robot', { status: 'in_progress' });
    const preferences = settings({
      alertPreferences: {
        interest: false,
        habit: false,
        review: false,
        goal: false,
        project: true,
      },
    });
    const progress = record('progress', 'motor', {
      parentId: project.id,
      occurredAt: '2026-11-07T12:00:00Z',
      value: 1,
    });
    expect(buildAlerts([project, progress], preferences, now)).toHaveLength(0);
    expect(
      buildAlerts([project, { ...progress, occurredAt: '2026-11-10T12:00:00Z' }], preferences, now),
    ).toHaveLength(1);
    const milestone = record('milestones', 'sensor', {
      parentId: project.id,
      status: 'completed',
      completedAt: '2026-11-07T12:00:00Z',
    });
    expect(buildAlerts([project, milestone], preferences, now)).toHaveLength(0);
    expect(
      buildAlerts([project, { ...milestone, status: 'pending' }], preferences, now),
    ).toHaveLength(1);
  });

  it('starts a fresh inactivity window on project resumption instead of charging for a pause', () => {
    const project = record('projects', 'robot', { status: 'in_progress' });
    const preferences = settings({
      alertPreferences: {
        interest: false,
        habit: false,
        review: false,
        goal: false,
        project: true,
      },
    });
    const history: HistoryEntry[] = [
      {
        id: 'pause',
        recordId: project.id,
        type: project.type,
        operation: 'update',
        occurredAt: '2026-10-25T12:00:00Z',
        before: project,
        after: { ...project, status: 'paused' },
      },
      {
        id: 'resume',
        recordId: project.id,
        type: project.type,
        operation: 'update',
        occurredAt: '2026-11-07T12:00:00Z',
        before: { ...project, status: 'paused' },
        after: project,
      },
    ];
    expect(buildAlerts([project], preferences, now, history)).toHaveLength(0);
    const later = buildAlerts([project], preferences, new Date('2026-11-23T18:00:00Z'), history);
    expect(later).toHaveLength(1);
    expect(later[0]?.href).toBe('/projects?id=robot');
  });

  it('creates deadline and inactivity alerts without alerting paused or completed work', () => {
    const goal = record('goals', 'learn', { endDate: '2026-11-10' });
    const project = record('projects', 'build', { status: 'in_progress' });
    const completed = record('projects', 'done', { status: 'completed' });
    const alerts = buildAlerts(
      [goal, project, completed],
      settings({
        alertPreferences: {
          interest: false,
          habit: false,
          review: false,
          goal: true,
          project: true,
        },
      }),
      now,
    );
    expect(alerts.map((alert) => alert.type).sort()).toEqual(['goal', 'project']);
    expect(alerts.some((alert) => alert.recordId === 'done')).toBe(false);
  });
});

describe('personal timeline', () => {
  it('keeps completion events on their historical date when a completed record is edited', () => {
    const project = record('projects', 'robot', {
      status: 'completed',
      updatedAt: '2026-11-08T12:00:00Z',
    });
    const history: HistoryEntry[] = [
      {
        id: 'history',
        recordId: project.id,
        type: project.type,
        operation: 'update',
        occurredAt: '2026-11-04T12:00:00Z',
        before: { ...project, status: 'in_progress' },
        after: { ...project, status: 'completed' },
      },
    ];
    expect(buildTimeline([project], {}, history)[0]?.date).toBe('2026-11-04T12:00:00Z');
  });

  it('preserves achieved events after reopening without duplicating a current completion', () => {
    const goal = record('goals', 'master', { status: 'active' });
    const completed = {
      ...goal,
      status: 'completed' as const,
      completedAt: '2026-10-28T12:00:00Z',
    };
    const history: HistoryEntry[] = [
      {
        id: 'completed',
        recordId: goal.id,
        type: goal.type,
        operation: 'update',
        occurredAt: '2026-10-28T12:00:00Z',
        before: goal,
        after: completed,
      },
      {
        id: 'reopened',
        recordId: goal.id,
        type: goal.type,
        operation: 'update',
        occurredAt: '2026-11-07T12:00:00Z',
        before: completed,
        after: goal,
      },
    ];
    expect(buildTimeline([goal], {}, history).map((event) => event.date)).toEqual([
      '2026-10-28T12:00:00Z',
    ]);
    expect(buildTimeline([completed], {}, history).map((event) => event.date)).toEqual([
      '2026-10-28T12:00:00Z',
    ]);
    const completedAgain = { ...completed, completedAt: '2026-11-08T12:00:00Z' };
    const historyAgain: HistoryEntry[] = [
      ...history,
      {
        id: 'completed-again',
        recordId: goal.id,
        type: goal.type,
        operation: 'update',
        occurredAt: '2026-11-08T12:00:00Z',
        before: goal,
        after: completedAgain,
      },
    ];
    const events = buildTimeline([completedAgain], {}, historyAgain);
    expect(events.map((event) => event.date)).toEqual([
      '2026-11-08T12:00:00Z',
      '2026-10-28T12:00:00Z',
    ]);
    expect(new Set(events.map((event) => event.id)).size).toBe(2);
  });

  it('opens milestones and progress through their parent detail instead of nonexistent routes', () => {
    const project = record('projects', 'robot');
    const goal = record('goals', 'master');
    const milestone = record('milestones', 'sensor', { parentId: project.id, status: 'completed' });
    const progress = record('progress', 'chapter', { parentId: goal.id, value: 1 });
    const timeline = buildTimeline([project, goal, milestone, progress]);
    expect(timeline.find((event) => event.recordId === milestone.id)?.href).toBe(
      '/projects?id=robot',
    );
    expect(timeline.find((event) => event.recordId === progress.id)?.href).toBe('/goals?id=master');
  });

  it('filters dates in the user timezone and paginates deterministic chronological events', () => {
    const session = record('activities', 'night', { occurredAt: '2026-11-02T03:30:00Z' });
    expect(
      buildTimeline([session], { from: '2026-11-01', to: '2026-11-01', timezone: 'America/Lima' }),
    ).toHaveLength(1);
    expect(
      buildTimeline([session], { from: '2026-11-02', to: '2026-11-02', timezone: 'America/Lima' }),
    ).toHaveLength(0);
    const learning = record('learnings', 'LiDAR', { occurredAt: '2026-11-06T12:00:00Z' });
    expect(buildTimeline([session, learning], { limit: 1 })[0]?.recordId).toBe('LiDAR');
    expect(buildTimeline([session, learning], { offset: 1, limit: 1 })[0]?.recordId).toBe('night');
  });
});
