import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSnapshot } from '../../../../domains/data/service';
import { habitCalendar, habitPeriods } from '../../../../domains/habits';
import { daysBetween } from '../../../../domains/analytics/dates';
import { apiOperation, HttpError, json } from '../../../../lib/auth';
const day = z.iso.date();
const query = z.object({ from: day, to: day });
export const GET: APIRoute = ({ params, url }) =>
  apiOperation(async () => {
    const range = query.parse(Object.fromEntries(url.searchParams));
    if (range.from > range.to || daysBetween(range.from, range.to) > 366)
      throw new HttpError(400, 'Elige un intervalo de hasta un año.');
    const snapshot = await getSnapshot();
    const habit = snapshot.records.find(
      (record) => record.id === params.id && record.type === 'habits',
    );
    if (!habit) throw new HttpError(404, 'El hábito no existe.');
    return json({
      calendar: habitCalendar(habit, snapshot.records, snapshot.settings, range.from, range.to),
      periods: habitPeriods(
        habit,
        snapshot.records,
        snapshot.settings,
        range.from,
        range.to,
        new Date(snapshot.generatedAt),
        snapshot.history,
      ),
    });
  });
