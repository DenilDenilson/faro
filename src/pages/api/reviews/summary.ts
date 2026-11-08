import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSnapshot } from '../../../domains/data/service';
import { compactRecord } from '../../../domains/data/views';
import { weeklySummary } from '../../../domains/reviews';
import { apiOperation, json } from '../../../lib/auth';
export const GET: APIRoute = ({ url }) =>
  apiOperation(async () => {
    const week = z.iso
      .date()
      .optional()
      .parse(url.searchParams.get('weekStart') ?? undefined);
    const snapshot = await getSnapshot();
    const summary = weeklySummary(
      snapshot.records,
      snapshot.settings,
      week,
      new Date(snapshot.generatedAt),
      snapshot.history,
    );
    return json({
      summary: {
        ...summary,
        activities: summary.activities.map((record) => compactRecord(record, 0)),
        completedHabits: summary.completedHabits.map((record) => compactRecord(record, 0)),
        projectsWithProgress: summary.projectsWithProgress.map((record) =>
          compactRecord(record, 0),
        ),
        goalsAttended: summary.goalsAttended.map((record) => compactRecord(record, 0)),
        unattendedAreas: summary.unattendedAreas.map((record) => compactRecord(record, 0)),
      },
    });
  });
