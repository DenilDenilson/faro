import { describe, expect, it } from 'vitest';
import {
  compactSnapshot,
  entitySummaries,
  getEntityPage,
  metadataSnapshot,
  recordDetailView,
} from '../src/domains/data/views';
import {
  DEFAULT_SETTINGS,
  type FaroRecord,
  type FaroSnapshot,
  type HistoryEntry,
} from '../src/lib/types';

const now = '2026-11-07T14:00:00.000Z';
function record(id: string, type: FaroRecord['type'], extra: Partial<FaroRecord> = {}): FaroRecord {
  return {
    id,
    type,
    name: id,
    description: '',
    status: 'active',
    createdAt: '2024-01-01T14:00:00.000Z',
    updatedAt: now,
    ...extra,
  };
}
function fixture(): FaroSnapshot {
  const oldInterest = record('robotics', 'interests', { areaId: 'technology', frequencyDays: 7 });
  const interest = {
    ...oldInterest,
    areaId: 'science',
    notes: 'a'.repeat(100_000),
    description: 'b'.repeat(20_000),
  };
  const history: HistoryEntry[] = [
    {
      id: 'move',
      recordId: interest.id,
      type: interest.type,
      occurredAt: '2026-06-01T14:00:00.000Z',
      operation: 'update',
      before: oldInterest,
      after: interest,
    },
  ];
  return {
    records: [
      record('technology', 'areas'),
      record('science', 'areas'),
      interest,
      record('old-session', 'activities', {
        occurredAt: '2025-01-03T14:00:00.000Z',
        durationMinutes: 120,
        interestIds: ['robotics'],
        notes: 'private session notes',
      }),
      record('recent-session', 'activities', {
        occurredAt: '2026-11-06T14:00:00.000Z',
        durationMinutes: 30,
        interestIds: ['robotics'],
      }),
      record('project', 'projects'),
      record('milestone', 'milestones', { parentId: 'project' }),
      record('progress', 'progress', { parentId: 'project', value: 2 }),
      record('review', 'reviews', { weekStart: '2026-11-02' }),
    ],
    settings: structuredClone(DEFAULT_SETTINGS),
    history,
    generatedAt: now,
  };
}

describe('server summaries and bounded view payloads', () => {
  it('keeps large notes, chronological logs and repeated historical text out of reference metadata', () => {
    const snapshot = fixture();
    snapshot.records.push(
      ...Array.from({ length: 240 }, (_, index) =>
        record(`learning-${index}`, 'learnings', {
          notes: 'x'.repeat(100_000),
          learningIds: ['robotics'],
          tags: ['private-tag'],
        }),
      ),
    );
    const metadata = metadataSnapshot(snapshot);
    expect(metadata.history).toHaveLength(0);
    expect(metadata.records.filter((entry) => entry.type === 'learnings')).toHaveLength(200);
    expect(
      metadata.records.some((entry) =>
        ['activities', 'reviews', 'progress', 'milestones'].includes(entry.type),
      ),
    ).toBe(false);
    expect(
      metadata.records.every(
        (entry) =>
          entry.description === '' &&
          entry.notes === undefined &&
          entry.learningIds === undefined &&
          entry.tags === undefined,
      ),
    ).toBe(true);
    expect(JSON.stringify(metadata).length).toBeLessThan(100_000);
    expect(snapshot.records.find((entry) => entry.id === 'robotics')?.notes).toHaveLength(100_000);
  });

  it('returns a page of twelve and a true full count, searching complete notes before projection', () => {
    const snapshot = fixture();
    snapshot.records.push(
      ...Array.from({ length: 25 }, (_, index) =>
        record(`learning-${index.toString().padStart(2, '0')}`, 'learnings', {
          notes: index === 17 ? 'a searchable discovery' : 'other notes',
        }),
      ),
    );
    const first = getEntityPage(snapshot, 'learnings', { sort: 'name' });
    const second = getEntityPage(snapshot, 'learnings', { sort: 'name', offset: '12' });
    expect(first).toMatchObject({ total: 25, limit: 12, offset: 0 });
    expect(first.records).toHaveLength(12);
    expect(second.records).toHaveLength(12);
    expect(
      first.records.some((entry) => second.records.some((other) => other.id === entry.id)),
    ).toBe(false);
    const search = getEntityPage(snapshot, 'learnings', { q: 'searchable discovery' });
    expect(search.total).toBe(1);
    expect(search.records[0]?.id).toBe('learning-17');
    expect(search.records[0]?.notes).toBeUndefined();
  });

  it('preserves lifetime totals and historical area attribution independently of the view window', () => {
    const snapshot = fixture();
    const summaries = entitySummaries(
      snapshot,
      snapshot.records.filter((entry) => ['areas', 'interests'].includes(entry.type)),
    );
    expect(summaries.robotics).toMatchObject({
      minutes: 150,
      sessionCount: 2,
      lastActivityAt: '2026-11-06T14:00:00.000Z',
    });
    expect(summaries.technology).toMatchObject({ minutes: 120, sessionCount: 1 });
    expect(summaries.science).toMatchObject({ minutes: 30, sessionCount: 1 });
    const compact = compactSnapshot(snapshot);
    expect(compact.view).toMatchObject({ totalActivities: 2, includedActivities: 1 });
    expect(compact.history[0]?.after?.notes).toBeUndefined();
    expect(compact.history[0]?.before?.areaId).toBe('technology');
    expect(
      getEntityPage(snapshot, 'activities', { area: 'technology' }).records.map(
        (entry) => entry.id,
      ),
    ).toEqual(['old-session']);
    expect(recordDetailView(snapshot, 'technology')?.activityTotal).toBe(1);
  });

  it('loads complete selected text for reading and editing while related rows remain projected and paginated', () => {
    const snapshot = fixture();
    const first = recordDetailView(snapshot, 'robotics', { limit: 1 });
    const next = recordDetailView(snapshot, 'robotics', { limit: 1, activityOffset: 1 });
    expect(first?.record.notes).toHaveLength(100_000);
    expect(first?.record.description).toHaveLength(20_000);
    expect(first?.summary.minutes).toBe(150);
    expect(first?.activityTotal).toBe(2);
    expect(
      first?.snapshot.records
        .filter((entry) => entry.type === 'activities')
        .map((entry) => entry.id),
    ).toEqual(['recent-session']);
    expect(
      next?.snapshot.records
        .filter((entry) => entry.type === 'activities')
        .map((entry) => entry.id),
    ).toEqual(['old-session']);
    expect(first?.snapshot.records.find((entry) => entry.id === 'robotics')?.notes).toBeUndefined();
    expect(recordDetailView(snapshot, 'missing')).toBeNull();
  });

  it('loads project milestones and measured progress only when opening their parent', () => {
    const snapshot = fixture();
    expect(metadataSnapshot(snapshot).records.some((entry) => entry.id === 'milestone')).toBe(
      false,
    );
    const detail = recordDetailView(snapshot, 'project');
    expect(detail?.snapshot.records.some((entry) => entry.id === 'milestone')).toBe(true);
    expect(detail?.snapshot.records.some((entry) => entry.id === 'progress')).toBe(true);
    expect(detail?.summary.project).toMatchObject({ totalMilestones: 1, completedMilestones: 0 });
  });
});
