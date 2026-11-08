import type { APIContext, APIRoute } from 'astro';
import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsResult } from '../src/domains/analytics';
import { DEFAULT_SETTINGS, type FaroRecord, type FaroSnapshot } from '../src/lib/types';
import { GET as analytics } from '../src/pages/api/analytics';
import { GET as timeline } from '../src/pages/api/timeline';

vi.mock('../src/domains/data/service', () => ({ getSnapshot: async () => snapshot }));

const base = {
  description: '',
  status: 'active' as const,
  createdAt: '2024-01-01T14:00:00.000Z',
  updatedAt: '2026-11-07T14:00:00.000Z',
};
const records: FaroRecord[] = [
  { ...base, id: 'area', type: 'areas', name: 'Conocimiento' },
  { ...base, id: 'interest', type: 'interests', name: 'Física', areaId: 'area', frequencyDays: 14 },
  {
    ...base,
    id: 'old',
    type: 'activities',
    name: 'Estudio de 2024',
    occurredAt: '2024-01-07T14:00:00.000Z',
    durationMinutes: 120,
    interestIds: ['interest'],
  },
  {
    ...base,
    id: 'recent',
    type: 'activities',
    name: 'Estudio reciente',
    occurredAt: '2026-11-06T14:00:00.000Z',
    durationMinutes: 30,
    interestIds: ['interest'],
  },
];
const snapshot: FaroSnapshot = {
  records,
  settings: DEFAULT_SETTINGS,
  history: [],
  generatedAt: '2026-11-07T14:00:00.000Z',
};
const call = (route: APIRoute, path: string) =>
  route({ url: new URL(path, 'https://faro.example') } as APIContext);

describe('server analysis and chronological pagination endpoints', () => {
  it('includes years of data in all-time analysis without sending raw sessions to the browser', async () => {
    const recent = await call(analytics, '/api/analytics');
    const recentBody = (await recent.json()) as { data: AnalyticsResult };
    expect(recentBody.data.totalMinutes).toBe(30);
    const all = await call(analytics, '/api/analytics?all=1');
    const allBody = (await all.json()) as { data: AnalyticsResult & { records?: FaroRecord[] } };
    expect(all.status).toBe(200);
    expect(allBody.data).toMatchObject({
      totalMinutes: 150,
      sessionCount: 2,
      startDate: '2024-01-07',
    });
    expect(allBody.data.records).toBeUndefined();
  });

  it('validates date ranges before running analysis', async () => {
    expect((await call(analytics, '/api/analytics?startDate=2026-02-30')).status).toBe(400);
    expect(
      (await call(analytics, '/api/analytics?startDate=2026-11-08&endDate=2026-11-01')).status,
    ).toBe(400);
  });

  it('paginates old and new activity events without dropping earlier years', async () => {
    const first = await call(timeline, '/api/timeline?type=activities&limit=1');
    const firstBody = (await first.json()) as {
      data: { events: { recordId: string }[]; hasMore: boolean };
    };
    expect(firstBody.data.events.map((entry) => entry.recordId)).toEqual(['recent']);
    expect(firstBody.data.hasMore).toBe(true);
    const second = await call(timeline, '/api/timeline?type=activities&limit=1&offset=1');
    const secondBody = (await second.json()) as {
      data: { events: { recordId: string }[]; hasMore: boolean };
    };
    expect(secondBody.data.events.map((entry) => entry.recordId)).toEqual(['old']);
    expect(secondBody.data.hasMore).toBe(false);
    const old = await call(timeline, '/api/timeline?type=activities&from=2024-01-01&to=2024-12-31');
    expect(
      ((await old.json()) as { data: { events: { recordId: string }[] } }).data.events.map(
        (entry) => entry.recordId,
      ),
    ).toEqual(['old']);
  });
});
