import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { createRepository, type FaroRepository } from '../src/domains/data/repository';
import { migrateDatabase } from '../src/db/migrations';
import { DEFAULT_SETTINGS, type FaroBackup } from '../src/lib/types';
import { parseRecordInput } from '../src/lib/validation';

let client: Client;
let repo: FaroRepository;
const base = (name: string) => ({ name, description: '', status: 'active' as const });

async function fixtures() {
  const area = await repo.saveRecord('areas', { ...base('Tecnología'), color: '#123456' });
  const interest = await repo.saveRecord('interests', {
    ...base('Robótica'),
    areaId: area.id,
    frequencyDays: 7,
    priority: 3,
  });
  const goal = await repo.saveRecord('goals', {
    ...base('Leer 12 capítulos'),
    interestIds: [interest.id],
    targetValue: 12,
    currentValue: 0,
    unit: 'capítulos',
  });
  const project = await repo.saveRecord('projects', {
    ...base('Construir robot'),
    status: 'in_progress',
    areaId: area.id,
    interestIds: [interest.id],
    goalIds: [goal.id],
  });
  const habit = await repo.saveRecord('habits', {
    ...base('Estudiar'),
    interestIds: [interest.id],
    cadence: 'weekly',
    targetCount: 2,
  });
  return { area, interest, goal, project, habit };
}

beforeEach(async () => {
  client = createClient({ url: 'file::memory:' });
  repo = await createRepository(client);
});
afterEach(() => {
  client.close();
});

describe('persistencia e integridad FARO', () => {
  it('crea solo tablas propias y migra de manera idempotente sin alterar tablas ajenas', async () => {
    await client.execute('CREATE TABLE another_application (value TEXT)');
    await client.execute("INSERT INTO another_application VALUES ('intacto')");
    await migrateDatabase(client);
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );
    expect(
      tables.rows
        .map((row) => String(row.name))
        .filter((name) => name !== 'another_application')
        .every((name) => name.startsWith('faro_')),
    ).toBe(true);
    expect((await client.execute('SELECT value FROM another_application')).rows[0]?.value).toBe(
      'intacto',
    );
    expect(
      (await client.execute('SELECT count(*) AS count FROM faro_migrations')).rows[0]?.count,
    ).toBe(1);
  });

  it('persiste relaciones tipadas y protege entidades referenciadas', async () => {
    const { area, interest } = await fixtures();
    await expect(repo.deleteRecord(area.id)).rejects.toMatchObject({
      status: 409,
      code: 'referenced_record',
    });
    await expect(
      repo.saveRecord('activities', {
        ...base('Inválida'),
        occurredAt: '2026-11-08T01:00:00Z',
        durationMinutes: 30,
        interestIds: [area.id],
      }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_relation_type' });
    await expect(
      repo.saveRecord('interests', { ...base('Sin padre'), areaId: 'missing', frequencyDays: 7 }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await repo.getRecord(interest.id))?.areaId).toBe(area.id);
  });

  it('mantiene una única sesión con varias relaciones y reintentos idempotentes', async () => {
    const { interest, goal, project, habit } = await fixtures();
    const input = {
      ...base('Entrenar agente'),
      occurredAt: '2026-11-08T01:00:00-05:00',
      durationMinutes: 90,
      interestIds: [interest.id],
      goalIds: [goal.id],
      habitIds: [habit.id],
      projectIds: [project.id],
      idempotencyKey: 'same-session-12345',
    };
    const activity = await repo.saveRecord('activities', input);
    const repeat = await repo.saveRecord('activities', input);
    expect(repeat.id).toBe(activity.id);
    expect(activity.occurredAt).toBe('2026-11-08T06:00:00.000Z');
    const activities = await repo.listRecords({ type: 'activities' });
    expect(activities).toHaveLength(1);
    expect(activities.reduce((sum, row) => sum + (row.durationMinutes ?? 0), 0)).toBe(90);
    await expect(
      repo.saveRecord('activities', { ...input, durationMinutes: 91 }),
    ).rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' });
    await expect(
      repo.saveRecord('activities', { ...input, idempotencyKey: 'different-session-12345' }),
    ).rejects.toMatchObject({ status: 409, code: 'duplicate' });
  });

  it('conserva cambios de frecuencia, prioridad y pausas en el historial', async () => {
    const { interest } = await fixtures();
    await repo.saveRecord(
      'interests',
      { frequencyDays: 14, priority: 1, status: 'paused' },
      interest.id,
    );
    const snapshot = await repo.getSnapshot();
    const history = snapshot.history.filter((entry) => entry.recordId === interest.id);
    expect(history).toHaveLength(2);
    expect(history[1]?.before?.frequencyDays).toBe(7);
    expect(history[1]?.after?.frequencyDays).toBe(14);
    expect(history[1]?.after?.status).toBe('paused');
    expect(history[1]?.after?.priority).toBe(1);
  });

  it('registra avances absolutos por fecha y no deduce metas de las horas', async () => {
    const { goal, interest } = await fixtures();
    await repo.saveRecord('activities', {
      ...base('Lectura'),
      occurredAt: '2026-11-07T10:00:00Z',
      durationMinutes: 120,
      interestIds: [interest.id],
      goalIds: [goal.id],
    });
    expect((await repo.getRecord(goal.id))?.currentValue).toBe(0);
    const recent = await repo.saveRecord('progress', {
      ...base('Capítulo 6'),
      parentId: goal.id,
      value: 6,
      occurredAt: '2026-11-07T12:00:00Z',
    });
    await repo.saveRecord('progress', {
      ...base('Capítulo 3 retrospectivo'),
      parentId: goal.id,
      value: 3,
      occurredAt: '2026-11-06T12:00:00Z',
    });
    expect((await repo.getRecord(goal.id))?.currentValue).toBe(6);
    await repo.deleteRecord(recent.id);
    expect((await repo.getRecord(goal.id))?.currentValue).toBe(3);
  });

  it('mantiene fecha de finalización estable después de editar el nombre', async () => {
    const goal = await repo.saveRecord('goals', { ...base('Meta'), status: 'completed' });
    const edited = await repo.saveRecord('goals', { name: 'Meta editada' }, goal.id);
    expect(edited.completedAt).toBe(goal.completedAt);
    await repo.saveRecord('goals', { status: 'active' }, goal.id);
    expect((await repo.getRecord(goal.id))?.completedAt).toBeUndefined();
  });

  it('conserva valor inicial al borrar mediciones y registra cambios manuales como avances', async () => {
    const goal = await repo.saveRecord('goals', {
      ...base('Libros'),
      targetValue: 12,
      currentValue: 2,
    });
    const progress = await repo.saveRecord('progress', {
      ...base('Libro 4'),
      parentId: goal.id,
      occurredAt: '2026-11-07T12:00:00Z',
      value: 4,
    });
    await repo.deleteRecord(progress.id);
    expect((await repo.getRecord(goal.id))?.currentValue).toBe(2);
    await repo.saveRecord('goals', { currentValue: 5 }, goal.id);
    const measurements = await repo.listRecords({ type: 'progress' });
    expect(measurements).toHaveLength(1);
    expect(measurements[0]?.value).toBe(5);
    expect((await repo.getRecord(goal.id))?.baselineValue).toBe(2);
    await expect(
      repo.saveRecord('progress', {
        ...base('Futuro'),
        parentId: goal.id,
        occurredAt: '2099-01-01T12:00:00Z',
        value: 7,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('distingue un objetivo sin mediciones de un valor real de cero', async () => {
    const goal = await repo.saveRecord('goals', { ...base('Sin medición'), targetValue: 12 });
    expect(goal.baselineValue).toBeUndefined();
    expect(goal.currentValue).toBeUndefined();
    const progress = await repo.saveRecord('progress', {
      ...base('Primer dato'),
      parentId: goal.id,
      occurredAt: '2026-11-07T12:00:00Z',
      value: 3,
    });
    await repo.deleteRecord(progress.id);
    expect((await repo.getRecord(goal.id))?.currentValue).toBeUndefined();
  });

  it('pagina consultas y permite snapshots de rango sin historial', async () => {
    const { interest } = await fixtures();
    for (let index = 1; index <= 3; index++)
      await repo.saveRecord('activities', {
        ...base(`Sesión ${index}`),
        occurredAt: `2026-11-0${index}T12:00:00Z`,
        durationMinutes: 30,
        interestIds: [interest.id],
      });
    expect(await repo.listRecords({ type: 'activities', limit: 2 })).toHaveLength(2);
    expect(await repo.listRecords({ type: 'activities', limit: 2, offset: 2 })).toHaveLength(1);
    const snapshot = await repo.getSnapshot({
      types: ['activities'],
      from: '2026-11-02T00:00:00Z',
      to: '2026-11-04T00:00:00Z',
      includeHistory: false,
    });
    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.history).toHaveLength(0);
  });

  it('filtra y cuenta por texto literal, área, interés y relaciones sin interpolar entradas', async () => {
    const { interest, area, project } = await fixtures();
    const activity = await repo.saveRecord('activities', {
      ...base('Estudio 100%_real'),
      occurredAt: '2026-11-07T12:00:00Z',
      durationMinutes: 30,
      interestIds: [interest.id],
      projectIds: [project.id],
    });
    await repo.saveRecord('activities', {
      ...base('Estudio 100XYZreal'),
      occurredAt: '2026-11-06T12:00:00Z',
      durationMinutes: 30,
      interestIds: [interest.id],
    });
    expect((await repo.listRecords({ search: '100%_real' })).map((record) => record.id)).toEqual([
      activity.id,
    ]);
    expect(
      await repo.countRecords({ type: 'activities', areaId: area.id, interestId: interest.id }),
    ).toBe(2);
    expect(await repo.countRecords({ search: "' OR 1=1 --" })).toBe(0);
    const related = await repo.getRelatedRecords(project.id, { type: 'activities' });
    expect(related.map((record) => record.id)).toEqual([activity.id]);
  });

  it('mantiene auditoría de eliminaciones aunque el registro ya no exista', async () => {
    const area = await repo.saveRecord('areas', base('Temporal'));
    await repo.deleteRecord(area.id);
    expect(await repo.getRecord(area.id)).toBeNull();
    const changes = (await repo.getSnapshot()).history;
    expect(changes.at(-1)).toMatchObject({ recordId: area.id, operation: 'delete', after: null });
    expect(changes.at(-1)?.before?.name).toBe('Temporal');
  });

  it('impide varias revisiones de una misma semana y exige inicio en lunes', async () => {
    await repo.saveRecord('reviews', { ...base('Semana'), weekStart: '2026-11-02' });
    await expect(
      repo.saveRecord('reviews', { ...base('Otra revisión'), weekStart: '2026-11-02' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      repo.saveRecord('reviews', { ...base('Martes'), weekStart: '2026-11-03' }),
    ).rejects.toMatchObject({ status: 400 });
    const backup = await repo.exportData();
    backup.records.find((record) => record.type === 'reviews')!.weekStart = '2026-11-03';
    await expect(repo.previewImport(backup)).rejects.toMatchObject({ status: 400 });
  });
});

describe('exportación e importación segura', () => {
  it('restaura entidades, relaciones, preferencias e historial en otra base y evita duplicados', async () => {
    const { interest } = await fixtures();
    await repo.updateSettings({ timezone: 'Europe/Madrid', theme: 'dark' });
    await repo.saveRecord('learnings', {
      ...base('Aprendizaje'),
      interestIds: [interest.id],
      tags: ['RL'],
      references: ['https://example.com/paper'],
    });
    const backup = await repo.exportData();
    const otherClient = createClient({ url: 'file::memory:' });
    try {
      const other = await createRepository(otherClient);
      const preview = await other.previewImport(backup);
      expect(preview.newRecords).toBe(backup.records.length);
      await other.importData(backup, { digest: preview.digest, restoreSettings: true });
      const restored = await other.exportData();
      expect(restored.records.map((record) => record.id).sort()).toEqual(
        backup.records.map((record) => record.id).sort(),
      );
      expect(restored.history).toEqual(backup.history);
      expect(restored.settings.timezone).toBe('Europe/Madrid');
      const repeat = await other.previewImport(backup);
      expect(repeat.duplicates).toBe(backup.records.length);
      expect((await other.importData(backup, { digest: repeat.digest })).imported).toBe(0);
    } finally {
      otherClient.close();
    }
  });

  it('muestra conflictos sin sobrescribir datos y exige previsualización vigente', async () => {
    const area = await repo.saveRecord('areas', base('Original'));
    const backup = await repo.exportData();
    const oldPreview = await repo.previewImport(backup);
    await repo.saveRecord('areas', { name: 'Editada localmente' }, area.id);
    await expect(repo.importData(backup, { digest: oldPreview.digest })).rejects.toMatchObject({
      code: 'stale_preview',
    });
    const preview = await repo.previewImport(backup);
    expect(preview.conflicts).toBe(1);
    const result = await repo.importData(backup, { digest: preview.digest });
    expect(result.skipped).toBe(1);
    expect((await repo.getRecord(area.id))?.name).toBe('Editada localmente');
  });

  it('detecta preferencias modificadas después de previsualizar y restaura mapas solo al confirmar', async () => {
    const backup = await repo.exportData();
    const original = await repo.previewImport(backup);
    await repo.updateAlertState('interest:later', 'dismiss');
    await expect(
      repo.importData(backup, { digest: original.digest, restoreSettings: true }),
    ).rejects.toMatchObject({ code: 'stale_preview' });
    const preview = await repo.previewImport(backup);
    await repo.importData(backup, { digest: preview.digest });
    expect((await repo.getSettings()).dismissedAlerts['interest:later']).toBeDefined();
    const restore = await repo.previewImport(backup);
    await repo.importData(backup, { digest: restore.digest, restoreSettings: true });
    expect((await repo.getSettings()).dismissedAlerts).toEqual({});
  });

  it('rechaza relaciones rotas y rollback completo ante un respaldo inválido', async () => {
    const { area } = await fixtures();
    const backup = await repo.exportData();
    backup.records = backup.records.filter((record) => record.id !== area.id);
    const otherClient = createClient({ url: 'file::memory:' });
    try {
      const other = await createRepository(otherClient);
      await expect(other.previewImport(backup)).rejects.toMatchObject({
        code: 'invalid_backup_relation',
      });
      expect((await other.getSnapshot()).records).toHaveLength(0);
    } finally {
      otherClient.close();
    }
  });

  it('rechaza fechas imposibles, enlaces inseguros e historial incoherente', async () => {
    expect(() =>
      parseRecordInput('seasons', {
        ...base('Inválida'),
        startDate: '2026-02-31',
        endDate: '2026-03-01',
      }),
    ).toThrow();
    expect(() =>
      parseRecordInput('seasons', {
        ...base('Mes inválido'),
        startDate: '2026-99-99',
        endDate: '2026-99-99',
      }),
    ).toThrow();
    expect(() =>
      parseRecordInput('learnings', { ...base('Sin zona'), occurredAt: '2026-11-07T12:00:00' }),
    ).toThrow();
    expect(() =>
      parseRecordInput('learnings', {
        ...base('Día inválido'),
        occurredAt: '2026-02-31T12:00:00Z',
      }),
    ).toThrow();
    expect(() =>
      parseRecordInput('learnings', { ...base('Mal enlace'), references: ['javascript:alert(1)'] }),
    ).toThrow();
    const area = await repo.saveRecord('areas', base('Área'));
    const backup = await repo.exportData();
    backup.history[0]!.recordId = `${area.id}-wrong`;
    await expect(repo.previewImport(backup)).rejects.toMatchObject({ status: 400 });
  });

  it('rechaza IDs repetidos y versiones desconocidas', async () => {
    const area = await repo.saveRecord('areas', base('Área'));
    const backup = await repo.exportData();
    backup.records.push(area);
    await expect(repo.previewImport(backup)).rejects.toMatchObject({ status: 400 });
    const unsupported = {
      format: 'faro',
      version: 2,
      exportedAt: new Date().toISOString(),
      records: [],
      settings: DEFAULT_SETTINGS,
      history: [],
    } as unknown as FaroBackup;
    await expect(repo.previewImport(unsupported)).rejects.toMatchObject({ status: 400 });
  });

  it('normaliza instantes con offset durante la importación', async () => {
    const { interest } = await fixtures();
    const activity = await repo.saveRecord('activities', {
      ...base('Sesión'),
      occurredAt: '2026-11-07T12:00:00Z',
      interestIds: [interest.id],
      durationMinutes: 30,
    });
    const backup = await repo.exportData();
    backup.records.find((record) => record.id === activity.id)!.occurredAt =
      '2026-11-07T07:00:00-05:00';
    const preview = await repo.previewImport(backup);
    expect(preview.conflicts).toBe(0);
    expect(preview.duplicates).toBe(backup.records.length);
  });
});

describe('protección persistente contra intentos repetidos', () => {
  it('coordina lecturas y escrituras concurrentes en libSQL local de una sola conexión', async () => {
    const [created, snapshot, settings, rows] = await Promise.all([
      repo.saveRecord('areas', base('Concurrente')),
      repo.getSnapshot(),
      repo.getSettings(),
      repo.listRecords({ type: 'areas' }),
    ]);
    expect(snapshot.records.some((record) => record.id === created.id)).toBe(true);
    expect(rows.some((record) => record.id === created.id)).toBe(true);
    expect(settings.timezone).toBe('America/Lima');
  });

  it('conserva descartes y posposiciones de dispositivos que actúan a la vez', async () => {
    await Promise.all([
      repo.updateAlertState('interest:first', 'dismiss'),
      repo.updateAlertState('habit:second', 'dismiss'),
      repo.updateAlertState('review:third', 'snooze'),
    ]);
    const settings = await repo.getSettings();
    expect(settings.dismissedAlerts['interest:first']).toBeDefined();
    expect(settings.dismissedAlerts['habit:second']).toBeDefined();
    expect(settings.snoozedAlerts['review:third']).toBeDefined();
    await expect(
      repo.updateAlertState('habit:second', 'snooze', '2020-01-01T00:00:00Z'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('permite cinco intentos, bloquea el siguiente y recupera tras la ventana', async () => {
    const now = Date.now();
    for (let index = 0; index < 5; index++)
      expect((await repo.consumeLoginAttempt('hashed-client', now + index)).allowed).toBe(true);
    expect(await repo.consumeLoginAttempt('hashed-client', now + 5)).toMatchObject({
      allowed: false,
      retryAfter: 900,
    });
    expect((await repo.consumeLoginAttempt('another-client', now + 5)).allowed).toBe(true);
    expect((await repo.consumeLoginAttempt('hashed-client', now + 16 * 60_000)).allowed).toBe(true);
    await repo.clearLoginAttempts('hashed-client');
    expect((await repo.consumeLoginAttempt('hashed-client', now + 16 * 60_000)).allowed).toBe(true);
  });
});

describe('campos opcionales borrados en actualizaciones JSON', () => {
  it('distingue conservar una meta de minutos de borrarla y conserva su historial', async () => {
    const { interest } = await fixtures();
    const habit = await repo.saveRecord('habits', {
      ...base('Gimnasio'),
      interestIds: [interest.id],
      cadence: 'weekly',
      targetMinutes: 90,
    });
    await repo.saveRecord('habits', { name: 'Gimnasio editado' }, habit.id);
    expect((await repo.getRecord(habit.id))?.targetMinutes).toBe(90);
    await repo.saveRecord('habits', JSON.parse(JSON.stringify({ targetMinutes: null })), habit.id);
    expect((await repo.getRecord(habit.id))?.targetMinutes).toBeUndefined();
    await repo.saveRecord('habits', { targetCount: 3 }, habit.id);
    await repo.saveRecord('habits', { targetMinutes: 60, targetCount: null }, habit.id);
    expect(await repo.getRecord(habit.id)).toMatchObject({ targetMinutes: 60 });
    expect((await repo.getRecord(habit.id))?.targetCount).toBeUndefined();
    await repo.saveRecord('habits', { targetMinutes: null, targetCount: 3 }, habit.id);
    const backup = await repo.exportData();
    expect(backup.records.find((record) => record.id === habit.id)).toMatchObject({
      targetCount: 3,
    });
    expect(backup.records.find((record) => record.id === habit.id)?.targetMinutes).toBeUndefined();
    expect(
      backup.history.some(
        (entry) =>
          entry.recordId === habit.id &&
          entry.before?.targetMinutes === 90 &&
          entry.after?.targetMinutes === undefined,
      ),
    ).toBe(true);
  });

  it('permite quitar fechas y relaciones opcionales sin dejar enlaces antiguos', async () => {
    const { project, area } = await fixtures();
    await repo.saveRecord('projects', { endDate: '2026-12-31' }, project.id);
    await repo.saveRecord('projects', { areaId: null, endDate: null }, project.id);
    expect((await repo.getRecord(project.id))?.areaId).toBeUndefined();
    expect((await repo.getRecord(project.id))?.endDate).toBeUndefined();
    expect((await repo.getRelatedRecords(area.id)).some((record) => record.id === project.id)).toBe(
      false,
    );
  });

  it('rechaza nulos para campos obligatorios y entradas desconocidas', async () => {
    const { habit, interest } = await fixtures();
    for (const patch of [
      { name: null },
      { description: null },
      { status: null },
      { unknownField: null },
      { cadence: null },
      null,
    ]) {
      await expect(repo.saveRecord('habits', patch, habit.id)).rejects.toMatchObject({
        status: 400,
      });
    }
    await expect(
      repo.saveRecord('interests', { frequencyDays: null }, interest.id),
    ).rejects.toMatchObject({ status: 400 });
    expect((await repo.getRecord(habit.id))?.name).toBe(habit.name);
  });
});
