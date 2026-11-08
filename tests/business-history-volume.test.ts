import { expect, it } from 'vitest';
import { buildAnalytics } from '../src/domains/analytics';
import { addDays } from '../src/domains/analytics/dates';
import { DEFAULT_SETTINGS, type EntityType, type FaroRecord } from '../src/lib/types';

it('analyses ten years of actual sessions and habit compliance without losing totals or truncating history', () => {
  const start = '2016-11-11';
  const end = addDays(start, 3649);
  const now = new Date(`${end}T18:00:00Z`);
  const makeRecord = (
    id: string,
    type: EntityType,
    fields: Partial<FaroRecord> = {},
  ): FaroRecord => ({
    id,
    type,
    name: id,
    description: '',
    status: 'active',
    createdAt: `${start}T12:00:00Z`,
    updatedAt: `${start}T12:00:00Z`,
    ...fields,
  });
  const records = [
    ...Array.from({ length: 4 }, (_, i) => makeRecord(`area-${i}`, 'areas')),
    ...Array.from({ length: 10 }, (_, i) =>
      makeRecord(`interest-${i}`, 'interests', { areaId: `area-${i % 4}`, frequencyDays: 7 }),
    ),
    ...Array.from({ length: 40 }, (_, i) =>
      makeRecord(`habit-${i}`, 'habits', {
        cadence: 'daily',
        targetCount: 1,
        interestIds: [`interest-${i % 10}`],
      }),
    ),
  ];
  for (let day = 0; day < 3650; day++) {
    const occurredAt = `${addDays(start, day)}T12:00:00Z`;
    for (let interest = 0; interest < 10; interest++) {
      const index = day * 10 + interest;
      records.push(
        makeRecord(`session-${index}`, 'activities', {
          occurredAt,
          durationMinutes: 30,
          interestIds: [`interest-${interest}`],
          habitIds: [`habit-${index % 40}`],
        }),
      );
    }
  }
  const result = buildAnalytics(records, DEFAULT_SETTINGS, { startDate: start, endDate: end }, now);
  expect(result.sessionCount).toBe(36_500);
  expect(result.totalMinutes).toBe(1_095_000);
  expect(result.daily).toHaveLength(3650);
  expect(result.habitCompletion).toHaveLength(40);
  expect(result.habitCompletion[0]?.eligiblePeriods).toBeGreaterThan(3600);
  expect(result.byArea.reduce((sum, area) => sum + area.minutes, 0)).toBe(result.totalMinutes);
  expect(result.monthly.reduce((sum, month) => sum + month.sessions, 0)).toBe(result.sessionCount);
  expect(result.attentionTrend).toHaveLength(1210);
}, 20_000);
