import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { createRepository, type FaroRepository } from '../src/domains/data/repository';
import { addDays, dateKey, startOfWeek } from '../src/domains/analytics/dates';
import { planningView } from '../src/domains/planning';
import type { WeekPlan, WeekTemplate } from '../src/domains/planning/types';

let client: Client;
let repo: FaroRepository;
const base = (name: string) => ({ name, description: '', status: 'active' });
const week = () => startOfWeek(dateKey(new Date(), 'America/Lima'));
beforeEach(async () => {
  client = createClient({ url: 'file::memory:' });
  repo = await createRepository(client);
});
afterEach(() => client.close());
async function fixture() {
  const area = await repo.saveRecord('areas', base('Salud'));
  const interest = await repo.saveRecord('interests', {
    ...base('Fuerza'),
    areaId: area.id,
    frequencyDays: 4,
  });
  const habit = await repo.saveRecord('habits', {
    ...base('Gimnasio'),
    interestIds: [interest.id],
    cadence: 'weekly',
    targetCount: 3,
  });
  const goal = await repo.saveRecord('goals', {
    ...base('Fuerza máxima'),
    interestIds: [interest.id],
    targetValue: 100,
    currentValue: 50,
  });
  const project = await repo.saveRecord('projects', {
    ...base('Programa'),
    interestIds: [interest.id],
  });
  return { area, interest, habit, goal, project };
}
async function plan(weekStart = week()) {
  const f = await fixture();
  const data = {
    name: 'Practicar sentadilla',
    interestIds: [f.interest.id],
    habitIds: [f.habit.id],
    goalIds: [f.goal.id],
    projectIds: [f.project.id],
    weekStart,
    day: addDays(weekStart, 2),
    estimatedMinutes: 60,
    notes: 'Técnica y movilidad',
  };
  const [item] = await repo.planningCommand({ action: 'save', data });
  return { ...f, item: item as WeekPlan, data };
}
describe('planificación semanal persistente', () => {
  it('separa planes de sesiones, mueve y elimina estimaciones sin restaurar valores anteriores', async () => {
    const { item, data } = await plan();
    const view = planningView(await repo.getSnapshot(), await repo.listPlanning(week()), week());
    expect(view.activities).toHaveLength(0);
    expect(view.rhythms[0].done).toBe(0);
    expect(view.rhythms[0].planned).toBe(1);
    const { day: _day, estimatedMinutes: _minutes, ...flexible } = data;
    await repo.planningCommand({ action: 'save', id: item.id, data: flexible });
    const updated = (await repo.listPlanning()).find((p) => p.id === item.id) as WeekPlan;
    expect(updated.day).toBeUndefined();
    expect(updated.estimatedMinutes).toBeUndefined();
    expect((await repo.exportData()).planningHistory).toHaveLength(2);
    await expect(
      repo.planningCommand({ action: 'save', data: { ...data, day: addDays(week(), 7) } }),
    ).rejects.toThrow();
  });
  it('registra y enlaza una sesión una sola vez ante reintentos concurrentes y conserva resultados independientes', async () => {
    const { item, habit, goal, project, interest } = await plan();
    const input = {
      action: 'complete',
      id: item.id,
      name: item.name,
      occurredAt: new Date().toISOString(),
      durationMinutes: 42,
      notes: 'Sesión real',
    };
    await Promise.all([repo.planningCommand(input), repo.planningCommand(input)]);
    const sessions = await repo.listRecords({ type: 'activities' });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      durationMinutes: 42,
      interestIds: [interest.id],
      habitIds: [habit.id],
      projectIds: [project.id],
      goalIds: [goal.id],
    });
    expect((await repo.getRecord(goal.id))?.currentValue).toBe(50);
    const view = planningView(await repo.getSnapshot(), await repo.listPlanning(week()), week());
    expect(view.rhythms[0].done).toBe(1);
    expect(view.rhythms[0].planned).toBe(0);
    await expect(repo.deleteRecord(sessions[0]!.id)).rejects.toMatchObject({ status: 409 });
    await expect(repo.planningCommand({ action: 'cancel', id: item.id })).rejects.toMatchObject({
      status: 409,
    });
  });
  it('rechaza sesiones futuras y relaciones incorrectas sin completar planes ni guardar actividad parcial', async () => {
    const { item, data, area } = await plan();
    await expect(
      repo.planningCommand({
        action: 'complete',
        id: item.id,
        name: 'Futura',
        occurredAt: new Date(Date.now() + 86400000).toISOString(),
        durationMinutes: 20,
      }),
    ).rejects.toThrow('no futura');
    await expect(
      repo.planningCommand({ action: 'save', data: { ...data, interestIds: [area.id] } }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await repo.listRecords({ type: 'activities' })).toHaveLength(0);
    expect(((await repo.listPlanning()).find((p) => p.id === item.id) as WeekPlan).status).toBe(
      'pending',
    );
  });
  it('reutiliza semanas tipo sin copiar sesiones y aplica cada plantilla una sola vez por semana', async () => {
    const { item } = await plan();
    const [template] = await repo.planningCommand({
      action: 'template',
      weekStart: week(),
      name: 'Mi semana habitual',
    });
    const next = addDays(week(), 7);
    await repo.planningCommand({ action: 'apply', templateId: template!.id, weekStart: next });
    await repo.planningCommand({ action: 'apply', templateId: template!.id, weekStart: next });
    const target = (await repo.listPlanning(next)).filter(
      (p): p is WeekPlan => p.kind === 'plan' && p.weekStart === next,
    );
    expect(target).toHaveLength(1);
    expect(target[0]).toMatchObject({
      day: addDays(next, 2),
      status: 'pending',
      estimatedMinutes: 60,
      notes: item.notes,
    });
    expect(target[0]?.activityId).toBeUndefined();
    expect(await repo.listRecords({ type: 'activities' })).toHaveLength(0);
    expect((template as WeekTemplate).slots[0]?.weekday).toBe(2);
  });
  it('solo retoma pendientes seleccionados y mantiene las otras semanas intactas', async () => {
    const { item } = await plan();
    const next = addDays(week(), 7);
    expect(
      (await repo.listPlanning(next)).filter((p) => p.kind === 'plan' && p.weekStart === next),
    ).toHaveLength(0);
    await repo.planningCommand({ action: 'copy', ids: [item.id], weekStart: next });
    await repo.planningCommand({ action: 'copy', ids: [item.id], weekStart: next });
    expect(
      (await repo.listPlanning(next)).filter((p) => p.kind === 'plan' && p.weekStart === next),
    ).toHaveLength(1);
    await repo.planningCommand({ action: 'cancel', id: item.id });
    await expect(
      repo.planningCommand({ action: 'copy', ids: [item.id], weekStart: addDays(next, 7) }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('sugiere cuotas semanales pendientes sin inventar días y respeta pausas y días personalizados', async () => {
    const { habit, interest } = await fixture();
    const next = addDays(week(), 7);
    await repo.planningCommand({ action: 'suggest', weekStart: next });
    await repo.planningCommand({ action: 'suggest', weekStart: next });
    let items = (await repo.listPlanning(next)).filter(
      (p): p is WeekPlan => p.kind === 'plan' && p.weekStart === next,
    );
    expect(items).toHaveLength(3);
    expect(items.every((p) => !p.day)).toBe(true);
    await repo.saveRecord('habits', { status: 'paused' }, habit.id);
    const custom = await repo.saveRecord('habits', {
      ...base('Movilidad'),
      interestIds: [interest.id],
      cadence: 'custom',
      weekdays: [1, 3, 5],
      targetCount: 3,
    });
    await repo.planningCommand({ action: 'suggest', weekStart: addDays(next, 7) });
    items = (await repo.listPlanning()).filter(
      (p): p is WeekPlan => p.kind === 'plan' && p.weekStart === addDays(next, 7),
    );
    expect(items).toHaveLength(3);
    expect(items.every((p) => p.habitIds?.includes(custom.id))).toBe(true);
    expect(items.map((p) => p.day).sort()).toEqual([
      addDays(next, 7),
      addDays(next, 9),
      addDays(next, 11),
    ]);
  });
  it('las sugerencias diarias no acumulan las prácticas de días pasados', async () => {
    const { habit } = await fixture();
    await repo.saveRecord('habits', { cadence: 'daily', targetCount: 2 }, habit.id);
    await repo.planningCommand({ action: 'suggest', weekStart: week() });
    await repo.planningCommand({ action: 'suggest', weekStart: week() });
    const items = (await repo.listPlanning()).filter((p): p is WeekPlan => p.kind === 'plan');
    const today = dateKey(new Date(), 'America/Lima');
    expect(items.every((p) => p.day! >= today)).toBe(true);
    for (const day of new Set(items.map((p) => p.day)))
      expect(items.filter((p) => p.day === day)).toHaveLength(2);
  });
  it('exporta y restaura planes, semanas tipo, relaciones e historial con previsualización sin sobrescribir', async () => {
    const { item } = await plan();
    await repo.planningCommand({ action: 'template', weekStart: week(), name: 'Rutina' });
    const backup = await repo.exportData();
    expect(backup.planning).toHaveLength(2);
    const otherClient = createClient({ url: 'file::memory:' });
    try {
      const other = await createRepository(otherClient);
      const preview = await other.previewImport(backup);
      expect(preview.planning?.newRecords).toBe(2);
      await other.importData(backup, { digest: preview.digest });
      const exported = await other.exportData();
      expect(exported.planning).toEqual(backup.planning);
      expect(exported.planningHistory).toEqual(backup.planningHistory);
      const again = await other.previewImport(backup);
      expect(again.planning?.duplicates).toBe(2);
      await other.planningCommand({ action: 'cancel', id: item.id });
      await expect(other.importData(backup, { digest: again.digest })).rejects.toMatchObject({
        code: 'stale_preview',
      });
      const fresh = await other.previewImport(backup);
      expect(fresh.planning?.conflicts).toBe(1);
      await other.importData(backup, { digest: fresh.digest });
      expect(((await other.listPlanning()).find((p) => p.id === item.id) as WeekPlan).status).toBe(
        'cancelled',
      );
    } finally {
      otherClient.close();
    }
  });
});

it('las sugerencias mensuales descuentan planes existentes en otra semana del mismo período', async () => {
  const { habit } = await fixture();
  // The first two weeks in a future month share one monthly target.
  const month = new Date();
  month.setUTCMonth(month.getUTCMonth() + 2, 1);
  const first = startOfWeek(month.toISOString().slice(0, 10));
  const next = addDays(first, 7);
  await repo.saveRecord('habits', { cadence: 'monthly', targetCount: 2 }, habit.id);
  await repo.planningCommand({ action: 'suggest', weekStart: next });
  await repo.planningCommand({ action: 'suggest', weekStart: addDays(next, 7) });
  const plans = (await repo.listPlanning()).filter((p): p is WeekPlan => p.kind === 'plan');
  expect(plans).toHaveLength(2);
});
it('acepta respaldos anteriores sin planificación y rechaza relaciones de planificación manipuladas', async () => {
  const { item } = await plan();
  const { planning: _planning, planningHistory: _history, ...legacy } = await repo.exportData();
  expect((await repo.previewImport(legacy)).planning?.total).toBe(0);
  const tampered = { ...legacy, planning: [{ ...item, interestIds: ['missing-interest'] }] };
  await expect(repo.previewImport(tampered)).rejects.toMatchObject({ status: 409 });
  const duplicate = { ...legacy, planning: [item, item] };
  await expect(repo.previewImport(duplicate)).rejects.toMatchObject({ status: 400 });
});
