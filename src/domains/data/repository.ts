import { createHash, randomUUID } from 'node:crypto';
import type { Client, InValue, Transaction } from '@libsql/client';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { ZodError } from 'zod';
import { getClient } from '../../db/client';
import { assertDatabaseMigrated, migrateDatabase } from '../../db/migrations';
import * as schema from '../../db/schema';
import {
  DEFAULT_SETTINGS,
  ENTITY_TYPES,
  type EntityType,
  type FaroBackup,
  type FaroRecord,
  type FaroSnapshot,
  type ImportPreview,
  type Settings,
  type SnapshotOptions,
  type ListRecordOptions,
} from '../../lib/types';
import { parseBackup, parseRecordInput, parseSettings } from '../../lib/validation';

export class DataError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'invalid_data',
  ) {
    super(message);
    this.name = 'DataError';
  }
}

interface Link {
  targetId: string;
  relation: string;
  expected: EntityType[];
}
type Executor = Pick<Client, 'execute'>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const parseJSON = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
const activityFingerprint = (record: FaroRecord): string | null =>
  record.type === 'activities'
    ? hash(
        canonical({
          name: record.name.trim().toLowerCase(),
          occurredAt: record.occurredAt && new Date(record.occurredAt).toISOString(),
          durationMinutes: record.durationMinutes,
          interestIds: [...(record.interestIds ?? [])].sort(),
        }),
      )
    : null;

function relationLinks(record: FaroRecord): Link[] {
  const result: Link[] = [];
  const add = (relation: string, ids: string[] | undefined, expected: EntityType[]) => {
    for (const targetId of ids ?? []) result.push({ targetId, relation, expected });
  };
  add('area', record.areaId ? [record.areaId] : [], ['areas']);
  add('interest', record.interestIds, ['interests']);
  add('habit', record.habitIds, ['habits']);
  add('project', record.projectIds, ['projects']);
  add('goal', record.goalIds, ['goals']);
  add('learning', record.learningIds, ['learnings']);
  add('activity', record.activityId ? [record.activityId] : [], ['activities']);
  add(
    'parent',
    record.parentId ? [record.parentId] : [],
    record.type === 'milestones' ? ['projects'] : ['goals', 'projects'],
  );
  for (const relation of ['focus', 'maintenance', 'exploration'] as const)
    add(relation, record[`${relation}Ids`], ['areas', 'interests', 'goals', 'projects']);
  return result;
}

async function getStored(executor: Executor, id: string): Promise<FaroRecord | null> {
  const found = await executor.execute({
    sql: 'SELECT data FROM faro_records WHERE id = ?',
    args: [id],
  });
  return found.rows[0] ? parseJSON<FaroRecord>(found.rows[0].data) : null;
}

async function validateRelations(
  record: FaroRecord,
  all: ReadonlyMap<string, Pick<FaroRecord, 'id' | 'type'>>,
): Promise<void> {
  for (const link of relationLinks(record)) {
    if (link.targetId === record.id)
      throw new DataError('Un registro no puede relacionarse consigo mismo', 400, 'self_relation');
    const target = all.get(link.targetId);
    if (!target)
      throw new DataError(
        `La relación «${link.relation}» apunta a un registro que no existe`,
        409,
        'missing_relation',
      );
    if (!link.expected.includes(target.type))
      throw new DataError(
        `El tipo de registro no es válido para la relación «${link.relation}»`,
        400,
        'invalid_relation_type',
      );
  }
}

async function referencedTypes(
  executor: Executor,
  record: FaroRecord,
): Promise<Map<string, Pick<FaroRecord, 'id' | 'type'>>> {
  const ids = [...new Set(relationLinks(record).map((link) => link.targetId))];
  const result = new Map<string, Pick<FaroRecord, 'id' | 'type'>>();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    const rows = await executor.execute({
      sql: `SELECT id,type FROM faro_records WHERE id IN (${batch.map(() => '?').join(',')})`,
      args: batch,
    });
    for (const row of rows.rows)
      result.set(String(row.id), { id: String(row.id), type: String(row.type) as EntityType });
  }
  return result;
}

async function allRecords(executor: Executor): Promise<Map<string, FaroRecord>> {
  const result = await executor.execute('SELECT data FROM faro_records');
  return new Map(
    result.rows.map((row) => {
      const record = parseJSON<FaroRecord>(row.data);
      return [record.id, record];
    }),
  );
}

async function persistRecord(executor: Executor, record: FaroRecord): Promise<void> {
  await executor.execute({
    sql: 'INSERT INTO faro_records (id,type,name,status,occurred_at,area_id,parent_id,week_start,created_at,updated_at,data,idempotency_key,dedupe_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,occurred_at=excluded.occurred_at,area_id=excluded.area_id,parent_id=excluded.parent_id,week_start=excluded.week_start,updated_at=excluded.updated_at,data=excluded.data,idempotency_key=excluded.idempotency_key,dedupe_key=excluded.dedupe_key',
    args: [
      record.id,
      record.type,
      record.name,
      record.status,
      record.occurredAt ?? null,
      record.areaId ?? null,
      record.parentId ?? null,
      record.weekStart ?? null,
      record.createdAt,
      record.updatedAt,
      JSON.stringify(record),
      record.idempotencyKey ?? null,
      activityFingerprint(record),
    ],
  });
}

async function persistLinks(executor: Executor, record: FaroRecord): Promise<void> {
  await executor.execute({ sql: 'DELETE FROM faro_links WHERE source_id = ?', args: [record.id] });
  for (const link of relationLinks(record))
    await executor.execute({
      sql: 'INSERT INTO faro_links(source_id,target_id,relation) VALUES (?,?,?)',
      args: [record.id, link.targetId, link.relation],
    });
}

async function audit(
  executor: Executor,
  before: FaroRecord | null,
  after: FaroRecord | null,
  occurredAt: string,
): Promise<void> {
  const record = after ?? before;
  if (!record) return;
  await executor.execute({
    sql: 'INSERT INTO faro_history(id,record_id,type,occurred_at,operation,before_data,after_data) VALUES (?,?,?,?,?,?,?)',
    args: [
      randomUUID(),
      record.id,
      record.type,
      occurredAt,
      !before ? 'create' : !after ? 'delete' : 'update',
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    ],
  });
}

async function synchronizeGoalProgress(
  executor: Executor,
  parentId: string | undefined,
  now: string,
): Promise<void> {
  if (!parentId) return;
  const parent = await getStored(executor, parentId);
  if (!parent || parent.type !== 'goals') return;
  const result = await executor.execute({
    sql: "SELECT data FROM faro_records WHERE type = 'progress' AND parent_id = ? AND occurred_at <= ? AND status != 'cancelled' ORDER BY occurred_at DESC, created_at DESC, id DESC LIMIT 1",
    args: [parentId, now],
  });
  const latest = result.rows[0] ? parseJSON<FaroRecord>(result.rows[0].data) : null;
  const value = latest?.value ?? parent.baselineValue;
  if (parent.currentValue === value) return;
  const next = { ...parent, currentValue: value, updatedAt: now };
  await persistRecord(executor, next);
  await audit(executor, parent, next, now);
}

const localClientOperations = new WeakMap<Client, Promise<void>>();
/** In-memory libSQL has a single connection; keep overlapping local requests safe. */
function withClientLock<T>(client: Client, run: () => Promise<T>): Promise<T> {
  if (client.protocol !== 'file') return run();
  const result = (localClientOperations.get(client) ?? Promise.resolve()).then(run);
  localClientOperations.set(
    client,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

async function transaction<T>(
  client: Client,
  run: (tx: Transaction) => Promise<T>,
  mode: 'read' | 'write' = 'write',
): Promise<T> {
  return withClientLock(client, async () => {
    const tx = await client.transaction(mode);
    try {
      const result = await run(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  });
}

async function storedSettings(executor: Executor): Promise<Settings> {
  const rows = await executor.execute({
    sql: 'SELECT data FROM faro_settings WHERE id = ?',
    args: ['preferences'],
  });
  return rows.rows[0]
    ? parseSettings(parseJSON<Settings>(rows.rows[0].data))
    : structuredClone(DEFAULT_SETTINGS);
}

function exposeError(error: unknown): never {
  if (error instanceof DataError) throw error;
  if (error instanceof ZodError)
    throw new DataError(error.issues.map((issue) => issue.message).join('. '));
  if (error instanceof Error && /UNIQUE constraint/i.test(error.message))
    throw new DataError(
      'Ya existe este registro. Revisa la sesión o la semana antes de volver a guardarlo.',
      409,
      'duplicate',
    );
  if (error instanceof Error && /FOREIGN KEY constraint/i.test(error.message))
    throw new DataError(
      'Otro registro utiliza este elemento. Desvincúlalo o archívalo antes de eliminarlo.',
      409,
      'referenced_record',
    );
  throw error;
}

export async function createRepository(client: Client, options: { migrate?: boolean } = {}) {
  await client.execute('PRAGMA foreign_keys = ON');
  if (options.migrate !== false) await migrateDatabase(client);
  else await assertDatabaseMigrated(client);
  const db = drizzle(client, { schema });

  async function getSettings(): Promise<Settings> {
    const saved = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.id, 'preferences'))
      .limit(1);
    return saved[0] ? parseSettings(saved[0].data) : structuredClone(DEFAULT_SETTINGS);
  }

  function recordConditions(options: ListRecordOptions): SQL[] {
    const conditions: SQL[] = [];
    if (options.type) {
      if (!ENTITY_TYPES.includes(options.type)) throw new DataError('Tipo de entidad desconocido');
      conditions.push(eq(schema.records.type, options.type));
    }
    if (options.status) conditions.push(eq(schema.records.status, options.status));
    if (options.search) {
      const pattern = `%${options.search.replace(/[!%_]/g, '!$&')}%`;
      conditions.push(sql`${schema.records.name} LIKE ${pattern} ESCAPE '!'`);
    }
    for (const date of [options.from, options.to])
      if (date && !Number.isFinite(Date.parse(date)))
        throw new DataError('Filtro de fecha inválido');
    if (options.from)
      conditions.push(
        sql`COALESCE(${schema.records.occurredAt}, ${schema.records.createdAt}) >= ${new Date(options.from).toISOString()}`,
      );
    if (options.to)
      conditions.push(
        sql`COALESCE(${schema.records.occurredAt}, ${schema.records.createdAt}) < ${new Date(options.to).toISOString()}`,
      );
    if (options.areaId)
      conditions.push(
        sql`(${schema.records.areaId} = ${options.areaId} OR ${schema.records.id} IN (SELECT l.source_id FROM faro_links l JOIN faro_records i ON i.id = l.target_id WHERE l.relation = 'interest' AND i.area_id = ${options.areaId}))`,
      );
    if (options.interestId)
      conditions.push(
        sql`${schema.records.id} IN (SELECT source_id FROM faro_links WHERE relation = 'interest' AND target_id = ${options.interestId})`,
      );
    if (options.parentId) conditions.push(eq(schema.records.parentId, options.parentId));
    return conditions;
  }

  function pagination(options: { limit?: number; offset?: number }): {
    limit: number;
    offset: number;
  } {
    if (
      (options.limit !== undefined && !Number.isFinite(options.limit)) ||
      (options.offset !== undefined && !Number.isFinite(options.offset))
    )
      throw new DataError('Paginación inválida');
    return {
      limit: Math.min(500, Math.max(1, Math.trunc(options.limit ?? 100))),
      offset: Math.max(0, Math.trunc(options.offset ?? 0)),
    };
  }

  async function listRecords(options: ListRecordOptions = {}): Promise<FaroRecord[]> {
    const { limit, offset } = pagination(options);
    const rows = await db
      .select({ data: schema.records.data })
      .from(schema.records)
      .where(and(...recordConditions(options)))
      .orderBy(
        desc(schema.records.occurredAt),
        desc(schema.records.createdAt),
        desc(schema.records.id),
      )
      .limit(limit)
      .offset(offset);
    return rows.map((row) => row.data);
  }

  async function countRecords(options: ListRecordOptions = {}): Promise<number> {
    const rows = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.records)
      .where(and(...recordConditions(options)));
    return Number(rows[0]?.total ?? 0);
  }

  async function getRelatedRecords(
    id: string,
    options: { type?: EntityType; limit?: number; offset?: number } = {},
  ): Promise<FaroRecord[]> {
    const { limit, offset } = pagination(options);
    const conditions: SQL[] = [
      sql`${schema.records.id} IN (SELECT target_id FROM faro_links WHERE source_id = ${id} UNION SELECT source_id FROM faro_links WHERE target_id = ${id})`,
    ];
    if (options.type) conditions.push(...recordConditions({ type: options.type }));
    const rows = await db
      .select({ data: schema.records.data })
      .from(schema.records)
      .where(and(...conditions))
      .orderBy(
        desc(schema.records.occurredAt),
        desc(schema.records.createdAt),
        desc(schema.records.id),
      )
      .limit(limit)
      .offset(offset);
    return rows.map((row) => row.data);
  }

  async function getSnapshot(options: SnapshotOptions = {}): Promise<FaroSnapshot> {
    for (const date of [options.from, options.to, options.historySince])
      if (date && !Number.isFinite(Date.parse(date)))
        throw new DataError('Filtro de fecha inválido');
    if (options.types?.some((type) => !ENTITY_TYPES.includes(type)))
      throw new DataError('Tipo de filtro desconocido');
    const predicates: string[] = [];
    const args: InValue[] = [];
    if (options.from) {
      predicates.push('COALESCE(occurred_at,created_at) >= ?');
      args.push(new Date(options.from).toISOString());
    }
    if (options.to) {
      predicates.push('COALESCE(occurred_at,created_at) < ?');
      args.push(new Date(options.to).toISOString());
    }
    if (options.types?.length) {
      predicates.push(`type IN (${options.types.map(() => '?').join(',')})`);
      args.push(...options.types);
    }
    return transaction(
      client,
      async (tx) => {
        const rows = await tx.execute({
          sql: `SELECT data FROM faro_records ${predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''} ORDER BY occurred_at DESC, created_at DESC, id DESC`,
          args,
        });
        const preferences = await tx.execute({
          sql: 'SELECT data FROM faro_settings WHERE id = ?',
          args: ['preferences'],
        });
        const changes = await tx.execute({
          sql: `SELECT * FROM faro_history ${options.includeHistory === false ? 'WHERE 0' : options.historySince ? 'WHERE occurred_at >= ?' : ''} ORDER BY occurred_at ASC, rowid ASC`,
          args:
            options.includeHistory !== false && options.historySince
              ? [new Date(options.historySince).toISOString()]
              : [],
        });
        const result: FaroSnapshot = {
          records: rows.rows.map((row) => parseJSON<FaroRecord>(row.data)),
          settings: preferences.rows[0]
            ? parseSettings(parseJSON<Settings>(preferences.rows[0].data))
            : structuredClone(DEFAULT_SETTINGS),
          history: changes.rows.map((row) => ({
            id: String(row.id),
            recordId: String(row.record_id),
            type: String(row.type) as EntityType,
            occurredAt: String(row.occurred_at),
            operation: String(row.operation) as 'create' | 'update' | 'delete',
            before: row.before_data ? parseJSON<FaroRecord>(row.before_data) : null,
            after: row.after_data ? parseJSON<FaroRecord>(row.after_data) : null,
          })),
          generatedAt: new Date().toISOString(),
        };
        return result;
      },
      'read',
    );
  }

  async function saveRecord(
    type: EntityType,
    input: unknown,
    recordId?: string,
  ): Promise<FaroRecord> {
    try {
      if (!ENTITY_TYPES.includes(type)) throw new DataError('Tipo de entidad desconocido');
      return await transaction(client, async (tx) => {
        const before = recordId ? await getStored(tx, recordId) : null;
        if (recordId && !before) throw new DataError('El registro ya no existe', 404, 'not_found');
        if (before && before.type !== type)
          throw new DataError('No se puede cambiar el tipo de un registro');
        const previousInput = before
          ? Object.fromEntries(
              Object.entries(before).filter(
                ([key]) => !['id', 'type', 'createdAt', 'updatedAt'].includes(key),
              ),
            )
          : {};
        const data = parseRecordInput(
          type,
          before ? { ...previousInput, ...(input as object) } : input,
        );
        const now = new Date().toISOString();
        const record: FaroRecord = {
          ...data,
          id: recordId ?? randomUUID(),
          type,
          createdAt: before?.createdAt ?? now,
          updatedAt: now,
        };
        if (type === 'goals')
          record.baselineValue =
            before?.baselineValue ?? before?.currentValue ?? record.currentValue;
        if (record.status === 'completed')
          record.completedAt =
            before?.status === 'completed' ? (before.completedAt ?? before.updatedAt) : now;
        else delete record.completedAt;
        if (record.occurredAt) record.occurredAt = new Date(record.occurredAt).toISOString();
        if (type === 'progress' && record.occurredAt && record.occurredAt > now)
          record.occurredAt = now;
        await validateRelations(record, await referencedTypes(tx, record));
        if (!recordId && record.idempotencyKey) {
          const matches = await tx.execute({
            sql: 'SELECT data FROM faro_records WHERE idempotency_key = ? LIMIT 1',
            args: [record.idempotencyKey],
          });
          const existing = matches.rows[0] ? parseJSON<FaroRecord>(matches.rows[0].data) : null;
          if (existing) {
            if (activityFingerprint(existing) !== activityFingerprint(record))
              throw new DataError(
                'La clave de registro ya se utilizó con otros datos',
                409,
                'idempotency_conflict',
              );
            return existing;
          }
        }
        await persistRecord(tx, record);
        await persistLinks(tx, record);
        await audit(tx, before, record, now);
        if (
          type === 'goals' &&
          before &&
          record.currentValue !== before.currentValue &&
          record.currentValue !== undefined
        ) {
          const measurement: FaroRecord = {
            id: randomUUID(),
            type: 'progress',
            name: `Medición: ${record.name}`,
            description: '',
            status: 'completed',
            parentId: record.id,
            value: record.currentValue,
            occurredAt: now,
            createdAt: now,
            updatedAt: now,
            completedAt: now,
          };
          await persistRecord(tx, measurement);
          await persistLinks(tx, measurement);
          await audit(tx, null, measurement, now);
        }
        if (type === 'progress') {
          if (before?.parentId && before.parentId !== record.parentId)
            await synchronizeGoalProgress(tx, before.parentId, now);
          await synchronizeGoalProgress(tx, record.parentId, now);
        }
        return record;
      });
    } catch (error) {
      exposeError(error);
    }
  }

  async function deleteRecord(id: string): Promise<void> {
    try {
      await transaction(client, async (tx) => {
        const record = await getStored(tx, id);
        if (!record) throw new DataError('El registro ya no existe', 404, 'not_found');
        const incoming = await tx.execute({
          sql: 'SELECT source_id FROM faro_links WHERE target_id = ? LIMIT 1',
          args: [id],
        });
        if (incoming.rows.length)
          throw new DataError(
            'Otro registro utiliza este elemento. Desvincúlalo o archívalo antes de eliminarlo.',
            409,
            'referenced_record',
          );
        const now = new Date().toISOString();
        await audit(tx, record, null, now);
        await tx.execute({ sql: 'DELETE FROM faro_records WHERE id = ?', args: [id] });
        if (record.type === 'progress') await synchronizeGoalProgress(tx, record.parentId, now);
      });
    } catch (error) {
      exposeError(error);
    }
  }

  async function updateSettings(input: Partial<Settings>): Promise<Settings> {
    try {
      return await transaction(client, async (tx) => {
        const result = await tx.execute({
          sql: 'SELECT data FROM faro_settings WHERE id = ?',
          args: ['preferences'],
        });
        const previous = result.rows[0]
          ? parseJSON<Settings>(result.rows[0].data)
          : structuredClone(DEFAULT_SETTINGS);
        const next = parseSettings({
          ...previous,
          ...input,
          alertPreferences: { ...previous.alertPreferences, ...input.alertPreferences },
          dismissedAlerts: { ...previous.dismissedAlerts, ...input.dismissedAlerts },
          snoozedAlerts: { ...previous.snoozedAlerts, ...input.snoozedAlerts },
        });
        await tx.execute({
          sql: 'INSERT INTO faro_settings(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
          args: ['preferences', JSON.stringify(next)],
        });
        return next;
      });
    } catch (error) {
      exposeError(error);
    }
  }

  async function updateAlertState(
    id: string,
    action: 'dismiss' | 'snooze',
    until?: string,
  ): Promise<Settings> {
    if (!id || id.length > 300 || !['dismiss', 'snooze'].includes(action))
      throw new DataError('Alerta o acción inválida');
    const now = Date.now();
    const postponedUntil = until ? Date.parse(until) : now + 24 * 60 * 60_000;
    if (
      action === 'snooze' &&
      (!Number.isFinite(postponedUntil) ||
        postponedUntil <= now ||
        postponedUntil > now + 366 * 24 * 60 * 60_000)
    )
      throw new DataError('Pospón la alerta a una fecha futura dentro del próximo año.');
    return transaction(client, async (tx) => {
      const result = await tx.execute({
        sql: 'SELECT data FROM faro_settings WHERE id = ?',
        args: ['preferences'],
      });
      const previous = result.rows[0]
        ? parseJSON<Settings>(result.rows[0].data)
        : structuredClone(DEFAULT_SETTINGS);
      const next: Settings =
        action === 'dismiss'
          ? {
              ...previous,
              dismissedAlerts: { ...previous.dismissedAlerts, [id]: new Date(now).toISOString() },
            }
          : {
              ...previous,
              snoozedAlerts: {
                ...previous.snoozedAlerts,
                [id]: new Date(postponedUntil).toISOString(),
              },
            };
      await tx.execute({
        sql: 'INSERT INTO faro_settings(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
        args: ['preferences', JSON.stringify(next)],
      });
      return next;
    });
  }

  async function exportData(): Promise<FaroBackup> {
    const snapshot = await getSnapshot();
    return {
      format: 'faro',
      version: 1,
      exportedAt: snapshot.generatedAt,
      records: snapshot.records,
      settings: snapshot.settings,
      history: snapshot.history,
    };
  }

  function preview(
    backup: FaroBackup,
    existing: Map<string, FaroRecord>,
    currentSettings: Settings,
  ): ImportPreview {
    const byType: Partial<Record<EntityType, number>> = {};
    let duplicates = 0;
    let conflicts = 0;
    for (const record of backup.records) {
      byType[record.type] = (byType[record.type] ?? 0) + 1;
      const old = existing.get(record.id);
      if (old) {
        if (old.type !== record.type)
          throw new DataError(
            'Un ID importado pertenece a un tipo diferente en la base actual',
            409,
            'id_type_conflict',
          );
        if (canonical(old) === canonical(record)) duplicates++;
        else conflicts++;
      }
    }
    const merged = new Map(existing);
    for (const record of backup.records) if (!merged.has(record.id)) merged.set(record.id, record);
    const fingerprints = new Map<string, string>();
    for (const record of merged.values()) {
      const fingerprintsForRecord = [
        activityFingerprint(record),
        record.idempotencyKey ? `key:${record.idempotencyKey}` : null,
        record.type === 'reviews' ? `week:${record.weekStart}` : null,
      ].filter((value): value is string => Boolean(value));
      for (const fingerprint of fingerprintsForRecord) {
        const previousId = fingerprints.get(fingerprint);
        if (previousId && previousId !== record.id)
          throw new DataError(
            'El respaldo contiene una sesión o revisión duplicada con otro ID. Corrige el archivo antes de importar.',
            409,
            'duplicate_backup_record',
          );
        fingerprints.set(fingerprint, record.id);
      }
    }
    for (const record of backup.records)
      for (const link of relationLinks(record)) {
        const target = merged.get(link.targetId);
        if (link.targetId === record.id || !target || !link.expected.includes(target.type))
          throw new DataError(
            'El respaldo contiene relaciones inválidas o incompletas',
            400,
            'invalid_backup_relation',
          );
      }
    const signature = [...existing.values()]
      .map((record) => [record.id, record.updatedAt])
      .sort(([a], [b]) => a!.localeCompare(b!));
    return {
      version: 1,
      total: backup.records.length,
      newRecords: backup.records.length - duplicates - conflicts,
      duplicates,
      conflicts,
      byType,
      warnings: conflicts
        ? [
            'Los registros existentes que difieren se conservarán sin cambios. Solo se incorporan IDs nuevos.',
          ]
        : [],
      digest: hash(canonical({ backup, signature, currentSettings })),
    };
  }

  async function previewImport(value: unknown): Promise<ImportPreview> {
    try {
      const backup = parseBackup(value);
      return await transaction(
        client,
        async (tx) => preview(backup, await allRecords(tx), await storedSettings(tx)),
        'read',
      );
    } catch (error) {
      exposeError(error);
    }
  }

  async function importData(
    value: unknown,
    options: { digest: string; restoreSettings?: boolean },
  ): Promise<ImportPreview & { imported: number; skipped: number }> {
    try {
      const backup = parseBackup(value);
      return await transaction(client, async (tx) => {
        const existing = await allRecords(tx);
        const summary = preview(backup, existing, await storedSettings(tx));
        if (!options?.digest || options.digest !== summary.digest)
          throw new DataError(
            'La base o el archivo cambiaron. Previsualiza nuevamente antes de importar.',
            409,
            'stale_preview',
          );
        const incoming = backup.records.filter((record) => !existing.has(record.id));
        for (const record of incoming) await persistRecord(tx, record);
        for (const record of incoming) await persistLinks(tx, record);
        const newIds = new Set(incoming.map((record) => record.id));
        for (const entry of backup.history) {
          // Historical deletions may have no current record. Keep them when the
          // ID does not conflict with a live record that is intentionally kept.
          if (existing.has(entry.recordId) && !newIds.has(entry.recordId)) continue;
          await tx.execute({
            sql: 'INSERT OR IGNORE INTO faro_history(id,record_id,type,occurred_at,operation,before_data,after_data) VALUES (?,?,?,?,?,?,?)',
            args: [
              entry.id,
              entry.recordId,
              entry.type,
              entry.occurredAt,
              entry.operation,
              entry.before ? JSON.stringify(entry.before) : null,
              entry.after ? JSON.stringify(entry.after) : null,
            ],
          });
        }
        const recordedIds = new Set(backup.history.map((entry) => entry.recordId));
        for (const record of incoming)
          if (!recordedIds.has(record.id)) await audit(tx, null, record, record.createdAt);
        for (const parentId of new Set(
          incoming.filter((record) => record.type === 'progress').map((record) => record.parentId),
        ))
          await synchronizeGoalProgress(tx, parentId, new Date().toISOString());
        if (options.restoreSettings)
          await tx.execute({
            sql: 'INSERT INTO faro_settings(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
            args: ['preferences', JSON.stringify(backup.settings)],
          });
        return {
          ...summary,
          imported: incoming.length,
          skipped: summary.duplicates + summary.conflicts,
        };
      });
    } catch (error) {
      exposeError(error);
    }
  }

  async function consumeLoginAttempt(
    key: string,
    now = Date.now(),
  ): Promise<{ allowed: boolean; retryAfter: number }> {
    const window = 15 * 60_000;
    return transaction(client, async (tx) => {
      const found = await tx.execute({
        sql: 'SELECT failures,blocked_until,window_start FROM faro_access_attempts WHERE key = ?',
        args: [key],
      });
      const previous = found.rows[0];
      if (previous && Number(previous.blocked_until) > now)
        return {
          allowed: false,
          retryAfter: Math.ceil((Number(previous.blocked_until) - now) / 1000),
        };
      const reset = !previous || now - Number(previous.window_start) >= window;
      const failures = reset ? 1 : Number(previous.failures) + 1;
      const blockedUntil = failures >= 5 ? now + window : 0;
      await tx.execute({
        sql: 'INSERT INTO faro_access_attempts(key,failures,blocked_until,window_start) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until,window_start=excluded.window_start',
        args: [key, failures, blockedUntil, reset ? now : Number(previous!.window_start)],
      });
      await tx.execute({
        sql: 'DELETE FROM faro_access_attempts WHERE window_start < ? AND blocked_until < ?',
        args: [now - 24 * 60 * 60_000, now],
      });
      return { allowed: true, retryAfter: 0 };
    });
  }

  return {
    getRecord: (id: string) => withClientLock(client, () => getStored(client, id)),
    listRecords: (options?: ListRecordOptions) =>
      withClientLock(client, () => listRecords(options)),
    countRecords: (options?: ListRecordOptions) =>
      withClientLock(client, () => countRecords(options)),
    getRelatedRecords: (
      id: string,
      options?: { type?: EntityType; limit?: number; offset?: number },
    ) => withClientLock(client, () => getRelatedRecords(id, options)),
    getSnapshot,
    saveRecord,
    deleteRecord,
    getSettings: () => withClientLock(client, getSettings),
    updateSettings,
    updateAlertState,
    exportData,
    previewImport,
    importData,
    consumeLoginAttempt,
    clearLoginAttempts: (key: string): Promise<void> =>
      withClientLock(client, async () => {
        await client.execute({
          sql: 'DELETE FROM faro_access_attempts WHERE key = ?',
          args: [key],
        });
      }),
  };
}

export type FaroRepository = Awaited<ReturnType<typeof createRepository>>;
let repository: Promise<FaroRepository> | undefined;
export async function getRepository(): Promise<FaroRepository> {
  repository ??= createRepository(getClient(), { migrate: process.env.NODE_ENV !== 'production' });
  try {
    return await repository;
  } catch (error) {
    repository = undefined;
    throw error;
  }
}
export const getRecord = async (id: string) => (await getRepository()).getRecord(id);
export const listRecords = async (options?: Parameters<FaroRepository['listRecords']>[0]) =>
  (await getRepository()).listRecords(options);
export const countRecords = async (options?: ListRecordOptions) =>
  (await getRepository()).countRecords(options);
export const getRelatedRecords = async (
  id: string,
  options?: Parameters<FaroRepository['getRelatedRecords']>[1],
) => (await getRepository()).getRelatedRecords(id, options);
export const getSnapshot = async (options?: SnapshotOptions) =>
  (await getRepository()).getSnapshot(options);
export const saveRecord = async (type: EntityType, input: unknown, id?: string) =>
  (await getRepository()).saveRecord(type, input, id);
export const deleteRecord = async (id: string) => (await getRepository()).deleteRecord(id);
export const getSettings = async () => (await getRepository()).getSettings();
export const updateSettings = async (input: Partial<Settings>) =>
  (await getRepository()).updateSettings(input);
export const updateAlertState = async (id: string, action: 'dismiss' | 'snooze', until?: string) =>
  (await getRepository()).updateAlertState(id, action, until);
export const exportData = async () => (await getRepository()).exportData();
export const previewImport = async (value: unknown) => (await getRepository()).previewImport(value);
export const importData = async (
  value: unknown,
  options: Parameters<FaroRepository['importData']>[1],
) => (await getRepository()).importData(value, options);
export const consumeLoginAttempt = async (key: string, now?: number) =>
  (await getRepository()).consumeLoginAttempt(key, now);
export const clearLoginAttempts = async (key: string) =>
  (await getRepository()).clearLoginAttempts(key);
