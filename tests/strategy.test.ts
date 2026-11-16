import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { createRepository, type FaroRepository } from '../src/domains/data/repository';
import { northView, strategyMetadata } from '../src/domains/strategy';
import { planningView } from '../src/domains/planning';
import { getEntityPage, metadataSnapshot } from '../src/domains/data/views';
import { dateKey, startOfWeek } from '../src/domains/analytics/dates';
let client: Client;
let repo: FaroRepository;
beforeEach(async () => {
  client = createClient({ url: 'file::memory:' });
  repo = await createRepository(client);
});
afterEach(() => client.close());
async function fixtures() {
  const area = await repo.saveRecord('areas', { name: 'Salud', order: 0 });
  const interest = await repo.saveRecord('interests', {
    name: 'Fuerza',
    areaId: area.id,
    frequencyDays: 4,
  });
  const vision = await repo.saveStrategy({
    kind: 'vision',
    name: 'Una vida activa',
    description: 'Con energía para aprender',
    purpose: 'Disfrutar de mis actividades',
    values: 'Curiosidad',
    recordIds: [area.id],
    resourceTypes: ['body', 'time'],
  });
  const key = await repo.saveStrategy({
    kind: 'key',
    name: 'Programar entrenamiento',
    stage: 'practicing',
    visionIds: [vision.id],
    resourceTypes: ['body'],
    recordIds: [interest.id],
  });
  const goal = await repo.saveRecord('goals', {
    name: 'Mi resultado',
    interestIds: [interest.id],
    visionIds: [vision.id],
    powerKeyIds: [key.id],
    purpose: 'Sentirme capaz',
    targetValue: 10,
    currentValue: 2,
    outcomes: 'Una medida explícita',
  });
  return { area, interest, vision, key, goal };
}
describe('visión, fuentes y claves de poder', () => {
  it('guarda versiones de la visión y permite quitar campos opcionales conservando el historial', async () => {
    const { vision } = await fixtures();
    await repo.saveStrategy(
      { description: 'Mi visión revisada', purpose: null, reviewDate: '2027-01-01' },
      vision.id,
    );
    const current = await repo.getStrategy(vision.id);
    expect(current?.description).toBe('Mi visión revisada');
    expect(current?.purpose).toBeUndefined();
    const history = await repo.strategyHistory(vision.id);
    expect(history).toHaveLength(2);
    expect(history[0]?.before?.purpose).toBe('Disfrutar de mis actividades');
  });
  it('valida relaciones, protege referencias y permite desvincular una visión de un objetivo', async () => {
    const { goal, vision, key } = await fixtures();
    await expect(repo.deleteStrategy(vision.id)).rejects.toMatchObject({ status: 409 });
    await expect(repo.saveRecord('goals', { visionIds: [key.id] }, goal.id)).rejects.toMatchObject({
      code: 'invalid_strategy_relation',
    });
    await repo.saveRecord('goals', { visionIds: [], powerKeyIds: [] }, goal.id);
    expect((await repo.getRecord(goal.id))?.visionIds).toEqual([]);
    await repo.saveStrategy({ visionIds: [] }, key.id);
    await repo.deleteStrategy(vision.id);
    expect(await repo.getStrategy(vision.id)).toBeNull();
  });
  it('distingue una clave en práctica de una aplicada y exige un ejemplo explícito o una experiencia real', async () => {
    const { key, interest } = await fixtures();
    await expect(repo.saveStrategy({ stage: 'applied' }, key.id)).rejects.toMatchObject({
      status: 400,
    });
    const future = await repo.saveRecord('activities', {
      name: 'Futura',
      interestIds: [interest.id],
      occurredAt: new Date(Date.now() + 86400000).toISOString(),
      durationMinutes: 30,
    });
    await expect(
      repo.saveStrategy({ stage: 'applied', recordIds: [future.id] }, key.id),
    ).rejects.toMatchObject({ status: 400 });
    const learning = await repo.saveRecord('learnings', {
      name: 'Lo que probé',
      description: 'Aplicación documentada',
      powerKeyIds: [key.id],
      interestIds: [interest.id],
    });
    await repo.saveStrategy({ stage: 'applied', recordIds: [learning.id] }, key.id);
    expect((await repo.getStrategy(key.id))?.stage).toBe('applied');
    await expect(repo.deleteRecord(learning.id)).rejects.toMatchObject({ status: 409 });
  });
  it('conserva cero como una medición real, muestra desconocido sin datos y no inventa progreso en objetivos', async () => {
    const { goal } = await fixtures();
    const indicator = await repo.saveStrategy({
      kind: 'indicator',
      name: 'Mi reserva',
      resourceType: 'money',
      unit: 'S/',
      minimum: 100,
      recordIds: [goal.id],
    });
    let view = northView(await repo.getSnapshot());
    expect(view.indicators[0]?.latest).toBeUndefined();
    expect(view.indicators[0]?.assessment).toBe('Sin mediciones');
    await repo.saveStrategy({
      kind: 'measurement',
      name: 'Saldo observado',
      indicatorId: indicator.id,
      value: 0,
      occurredAt: new Date().toISOString(),
    });
    view = northView(await repo.getSnapshot());
    expect(view.indicators[0]?.latest?.value).toBe(0);
    expect(view.indicators[0]?.latest?.unit).toBe('S/');
    expect(view.indicators[0]?.assessment).toBe('Por debajo de tu mínimo');
    expect((await repo.getRecord(goal.id))?.currentValue).toBe(2);
    await expect(repo.saveStrategy({ unit: 'USD' }, indicator.id)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      repo.saveStrategy({
        kind: 'measurement',
        name: 'Futura',
        indicatorId: indicator.id,
        value: 20,
        occurredAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    ).rejects.toThrow('no futura');
    await repo.saveStrategy({ minimum: null, maximum: null }, indicator.id);
    expect((await repo.getStrategy(indicator.id))?.minimum).toBeUndefined();
  });
  it('elige la medición por fecha, conserva unidades separadas y permite archivar observaciones', async () => {
    const a = await repo.saveStrategy({
      kind: 'indicator',
      name: 'Horas declaradas',
      resourceType: 'time',
      unit: 'horas',
    });
    const b = await repo.saveStrategy({
      kind: 'indicator',
      name: 'Reserva',
      resourceType: 'money',
      unit: 'S/',
    });
    await repo.saveStrategy({
      kind: 'measurement',
      name: 'Anterior',
      indicatorId: a.id,
      value: 8,
      occurredAt: '2025-01-01T12:00:00.000Z',
    });
    const latest = await repo.saveStrategy({
      kind: 'measurement',
      name: 'Reciente',
      indicatorId: a.id,
      value: 5,
      occurredAt: new Date().toISOString(),
    });
    await repo.saveStrategy({
      kind: 'measurement',
      name: 'Dinero',
      indicatorId: b.id,
      value: 20,
      occurredAt: new Date().toISOString(),
    });
    let view = northView(await repo.getSnapshot());
    expect(view.indicators.find((s) => s.indicator.id === a.id)?.latest?.value).toBe(5);
    expect(view.indicators.find((s) => s.indicator.id === b.id)?.latest?.value).toBe(20);
    await repo.saveStrategy({ status: 'archived' }, latest.id);
    view = northView(await repo.getSnapshot());
    expect(view.indicators.find((s) => s.indicator.id === a.id)?.latest?.value).toBe(8);
    await expect(repo.deleteStrategy(a.id)).rejects.toMatchObject({ status: 409 });
  });
  it('relaciona sesiones con las capacidades de sus objetivos sin cambiar el estado de dominio de la clave', async () => {
    const { goal, key, interest, vision } = await fixtures();
    const activity = await repo.saveRecord('activities', {
      name: 'Práctica',
      interestIds: [interest.id],
      goalIds: [goal.id],
      durationMinutes: 20,
      occurredAt: new Date().toISOString(),
    });
    expect(activity.powerKeyIds).toEqual([key.id]);
    expect(activity.visionIds).toEqual([vision.id]);
    expect((await repo.getStrategy(key.id))?.stage).toBe('practicing');
    expect((await repo.getRecord(goal.id))?.currentValue).toBe(2);
  });
  it('muestra proyectos y objetivos sin programación semanal y conserva hitos y métricas reales', async () => {
    const { goal, interest } = await fixtures();
    const project = await repo.saveRecord('projects', {
      name: 'Primer proyecto',
      status: 'pending',
      interestIds: [interest.id],
      goalIds: [goal.id],
    });
    await repo.saveRecord('milestones', {
      name: 'Primer paso pendiente',
      parentId: project.id,
      status: 'pending',
    });
    await repo.saveRecord('projects', { name: 'Archivado', status: 'archived' });
    const snapshot = await repo.getSnapshot();
    const view = planningView(
      snapshot,
      [],
      startOfWeek(dateKey(snapshot.generatedAt, snapshot.settings.timezone)),
    );
    expect(view.openWork.map((r) => r.record.id)).toEqual(
      expect.arrayContaining([goal.id, project.id]),
    );
    expect(view.openWork).toHaveLength(2);
    expect(view.openWork.find((r) => r.record.id === project.id)?.nextMilestone?.name).toBe(
      'Primer paso pendiente',
    );
    expect(view.openWork.find((r) => r.record.id === goal.id)?.progress).toBe(0.2);
  });
  it('agrupa intereses antes de paginar y conserva la búsqueda y el orden dentro del área', async () => {
    const { area } = await fixtures();
    const second = await repo.saveRecord('areas', { name: 'Arte', order: 1 });
    await repo.saveRecord('interests', {
      name: 'Guitarra',
      areaId: second.id,
      frequencyDays: 7,
      priority: 3,
    });
    await repo.saveRecord('interests', {
      name: 'Movilidad',
      areaId: area.id,
      frequencyDays: 7,
      priority: 1,
    });
    const snapshot = await repo.getSnapshot();
    const page = getEntityPage(snapshot, 'interests', { limit: 2 });
    expect(page.records.every((r) => r.areaId === area.id)).toBe(true);
    expect(getEntityPage(snapshot, 'interests', { q: 'Guitarra' }).records[0]?.areaId).toBe(
      second.id,
    );
  });
  it('mantiene medidas e historiales fuera de las referencias compactas de los formularios', async () => {
    const { vision, key } = await fixtures();
    const indicator = await repo.saveStrategy({
      kind: 'indicator',
      name: 'Tiempo',
      resourceType: 'time',
      unit: 'h',
    });
    await repo.saveStrategy({
      kind: 'measurement',
      name: 'Observación',
      indicatorId: indicator.id,
      value: 3,
      occurredAt: new Date().toISOString(),
    });
    const compact = metadataSnapshot(await repo.getSnapshot());
    expect(compact.strategy?.map((i) => i.id)).toEqual(expect.arrayContaining([vision.id, key.id]));
    expect(compact.strategy?.some((i) => i.kind === 'measurement')).toBe(false);
    expect(
      strategyMetadata(compact.strategy ?? []).find((i) => i.id === vision.id)?.description,
    ).toBe('');
  });
  it('restaura estrategia, relaciones cruzadas e historial y rechaza vistas previas caducadas y datos manipulados', async () => {
    const { goal, vision, key } = await fixtures();
    await repo.saveStrategy({
      kind: 'review',
      name: 'Revisión',
      reviewPeriod: 'monthly',
      reviewDay: '2026-11-16',
      visionIds: [vision.id],
      keyIds: [key.id],
      recordIds: [goal.id],
      reflections: 'Mantener mi dirección',
      decisions: 'Reservar tiempo',
    });
    const backup = await repo.exportData();
    const target = createClient({ url: 'file::memory:' });
    try {
      const other = await createRepository(target);
      const preview = await other.previewImport(backup);
      expect(preview.strategy?.newRecords).toBe(3);
      await other.importData(backup, { digest: preview.digest });
      const restored = await other.exportData();
      expect(restored.strategy).toEqual(backup.strategy);
      expect(restored.strategyHistory).toEqual(backup.strategyHistory);
      expect((await other.getRecord(goal.id))?.powerKeyIds).toEqual([key.id]);
      const old = await other.previewImport(backup);
      await other.saveStrategy({ description: 'Revisada' }, vision.id);
      await expect(other.importData(backup, { digest: old.digest })).rejects.toMatchObject({
        code: 'stale_preview',
      });
      const conflict = await other.previewImport(backup);
      expect(conflict.strategy?.conflicts).toBe(1);
      await other.importData(backup, { digest: conflict.digest });
      expect((await other.getStrategy(vision.id))?.description).toBe('Revisada');
      const tampered = {
        ...backup,
        strategy: backup.strategy?.map((i) =>
          i.id === key.id ? { ...i, visionIds: ['missing'] } : i,
        ),
      };
      await expect(other.previewImport(tampered)).rejects.toMatchObject({ status: 409 });
    } finally {
      target.close();
    }
  });
  it('admite respaldos anteriores sin estrategia y conserva las reflexiones estratégicas semanales', async () => {
    const { vision } = await fixtures();
    const snapshot = await repo.getSnapshot();
    const review = await repo.saveRecord('reviews', {
      name: 'Mi semana',
      weekStart: startOfWeek(dateKey(snapshot.generatedAt, snapshot.settings.timezone)),
      visionIds: [vision.id],
      directionReview: 'Continuar',
      resourceReview: 'Reservar tiempo',
      capabilityReview: 'Practicar lo aprendido',
    });
    expect((await repo.getRecord(review.id))?.directionReview).toBe('Continuar');
    const { strategy: _s, strategyHistory: _h, ...legacy } = await repo.exportData();
    legacy.records = legacy.records.map(({ visionIds: _v, powerKeyIds: _k, ...record }) => record);
    expect((await repo.previewImport(legacy)).strategy?.total).toBe(0);
  });
});

it('conserva una declaración de aplicación al desvincular una evidencia y mantiene sus respaldos restaurables', async () => {
  const { key, interest } = await fixtures();
  const learning = await repo.saveRecord('learnings', {
    name: 'Experiencia aplicada',
    interestIds: [interest.id],
    powerKeyIds: [key.id],
  });
  await repo.saveStrategy({ stage: 'applied' }, key.id);
  await repo.saveRecord('learnings', { powerKeyIds: [] }, learning.id);
  await repo.saveStrategy({ purpose: 'Revisar y seguir practicando' }, key.id);
  expect((await repo.getStrategy(key.id))?.stage).toBe('applied');
  const backup = await repo.exportData();
  const target = createClient({ url: 'file::memory:' });
  try {
    const other = await createRepository(target);
    const preview = await other.previewImport(backup);
    await other.importData(backup, { digest: preview.digest });
    expect((await other.getStrategy(key.id))?.stage).toBe('applied');
    expect(
      (await other.strategyHistory(key.id)).some((change) => change.after?.stage === 'applied'),
    ).toBe(true);
  } finally {
    target.close();
  }
});
