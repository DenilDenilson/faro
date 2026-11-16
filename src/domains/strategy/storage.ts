import { randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import type { FaroRecord } from '../../lib/types';
import { DataError } from '../../lib/data-error';
import type { StrategyItem, StrategyHistory } from './types';
import { parseStrategyInput } from './validation';
export type Executor = Pick<Client, 'execute'>;
const decode = <T>(v: unknown): T => JSON.parse(String(v)) as T;
export async function listStrategy(tx: Executor): Promise<StrategyItem[]> {
  return (await tx.execute('SELECT data FROM faro_strategy ORDER BY id')).rows.map((r) =>
    decode<StrategyItem>(r.data),
  );
}
export async function getStrategy(tx: Executor, id: string): Promise<StrategyItem | null> {
  const result = await tx.execute({ sql: 'SELECT data FROM faro_strategy WHERE id=?', args: [id] });
  return result.rows[0] ? decode<StrategyItem>(result.rows[0].data) : null;
}
export function strategyEdges(item: StrategyItem) {
  return [
    ...(item.visionIds ?? []).map((id) => ({ id, kind: 'vision', relation: 'vision' })),
    ...(item.keyIds ?? []).map((id) => ({ id, kind: 'key', relation: 'key' })),
    ...(item.indicatorId
      ? [{ id: item.indicatorId, kind: 'indicator', relation: 'indicator' }]
      : []),
  ];
}
export function recordStrategyEdges(record: FaroRecord) {
  return [
    ...(record.visionIds ?? []).map((id) => ({ id, kind: 'vision', relation: 'vision' })),
    ...(record.powerKeyIds ?? []).map((id) => ({ id, kind: 'key', relation: 'key' })),
  ];
}
export async function validateRecordStrategy(
  tx: Executor,
  record: FaroRecord,
  items?: ReadonlyMap<string, StrategyItem>,
): Promise<void> {
  for (const edge of recordStrategyEdges(record)) {
    const target = items ? items.get(edge.id) : await getStrategy(tx, edge.id);
    if (!target || target.kind !== edge.kind)
      throw new DataError(
        'La visión o clave relacionada no existe o tiene otro tipo',
        409,
        'invalid_strategy_relation',
      );
  }
}
export function assertAppliedEvidence(item: StrategyItem, records: FaroRecord[]): void {
  const now = new Date().toISOString();
  const evidence =
    Boolean(item.evidence?.trim()) ||
    records.some(
      (record) =>
        ['activities', 'learnings'].includes(record.type) &&
        record.status !== 'cancelled' &&
        (record.occurredAt ?? record.createdAt) <= now,
    );
  if (item.kind === 'key' && item.stage === 'applied' && !evidence)
    throw new DataError(
      'Añade un ejemplo de aplicación o vincula una actividad o aprendizaje para marcar esta clave como aplicada',
    );
}
export async function validateStrategy(
  tx: Executor,
  item: StrategyItem,
  items?: ReadonlyMap<string, StrategyItem>,
  records?: ReadonlyMap<string, FaroRecord>,
  requireApplicationEvidence = true,
): Promise<void> {
  for (const edge of strategyEdges(item)) {
    const target = items ? items.get(edge.id) : await getStrategy(tx, edge.id);
    if (edge.id === item.id || !target || target.kind !== edge.kind)
      throw new DataError(
        'Una relación de estrategia no existe o tiene otro tipo',
        409,
        'invalid_strategy_relation',
      );
  }
  const evidenceRecords: FaroRecord[] = [];
  for (const id of item.recordIds ?? []) {
    const target = records
      ? records.get(id)
      : decode<FaroRecord | null>(
          (await tx.execute({ sql: 'SELECT data FROM faro_records WHERE id=?', args: [id] }))
            .rows[0]?.data ?? 'null',
        );
    if (!target)
      throw new DataError(
        'Un registro relacionado con la estrategia ya no existe',
        409,
        'invalid_strategy_relation',
      );
    evidenceRecords.push(target);
  }
  if (requireApplicationEvidence && item.kind === 'key' && item.stage === 'applied') {
    const inverse = await tx.execute({
      sql: "SELECT r.data FROM faro_records r JOIN faro_strategy_record_links l ON l.record_id=r.id WHERE l.strategy_id=? AND l.relation='key'",
      args: [item.id],
    });
    evidenceRecords.push(...inverse.rows.map((row) => decode<FaroRecord>(row.data)));
  }
  if (requireApplicationEvidence) assertAppliedEvidence(item, evidenceRecords);
}
export async function persistRecordStrategy(tx: Executor, record: FaroRecord): Promise<void> {
  await tx.execute({
    sql: "DELETE FROM faro_strategy_record_links WHERE record_id=? AND relation IN ('vision','key')",
    args: [record.id],
  });
  for (const edge of recordStrategyEdges(record))
    await tx.execute({
      sql: 'INSERT INTO faro_strategy_record_links(record_id,strategy_id,relation) VALUES (?,?,?)',
      args: [record.id, edge.id, edge.relation],
    });
}
export async function persistStrategy(
  tx: Executor,
  item: StrategyItem,
  links = true,
): Promise<void> {
  await tx.execute({
    sql: 'INSERT INTO faro_strategy(id,kind,status,indicator_id,occurred_at,data) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,indicator_id=excluded.indicator_id,occurred_at=excluded.occurred_at,data=excluded.data',
    args: [
      item.id,
      item.kind,
      item.status,
      item.indicatorId ?? null,
      item.occurredAt ?? null,
      JSON.stringify(item),
    ],
  });
  if (links) await persistStrategyLinks(tx, item);
}
export async function persistStrategyLinks(tx: Executor, item: StrategyItem): Promise<void> {
  await tx.execute({ sql: 'DELETE FROM faro_strategy_links WHERE source_id=?', args: [item.id] });
  await tx.execute({
    sql: "DELETE FROM faro_strategy_record_links WHERE strategy_id=? AND relation='context'",
    args: [item.id],
  });
  for (const edge of strategyEdges(item))
    await tx.execute({
      sql: 'INSERT INTO faro_strategy_links(source_id,target_id,relation) VALUES (?,?,?)',
      args: [item.id, edge.id, edge.relation],
    });
  for (const recordId of item.recordIds ?? [])
    await tx.execute({
      sql: "INSERT INTO faro_strategy_record_links(record_id,strategy_id,relation) VALUES (?,?,'context')",
      args: [recordId, item.id],
    });
}
export async function auditStrategy(
  tx: Executor,
  before: StrategyItem | null,
  after: StrategyItem | null,
): Promise<void> {
  const item = after ?? before;
  if (!item) return;
  const entry: StrategyHistory = {
    id: randomUUID(),
    itemId: item.id,
    occurredAt: new Date().toISOString(),
    before,
    after,
  };
  await tx.execute({
    sql: 'INSERT INTO faro_strategy_history(id,item_id,occurred_at,data) VALUES (?,?,?,?)',
    args: [entry.id, item.id, entry.occurredAt, JSON.stringify(entry)],
  });
}
export async function saveStrategy(
  tx: Executor,
  input: unknown,
  id?: string,
): Promise<StrategyItem> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new DataError('Los cambios deben ser un objeto');
  const before = id ? await getStrategy(tx, id) : null;
  if (id && !before)
    throw new DataError('El registro de estrategia ya no existe', 404, 'not_found');
  const previous = before
    ? Object.fromEntries(
        Object.entries(before).filter(([key]) => !['id', 'createdAt', 'updatedAt'].includes(key)),
      )
    : {};
  const data = parseStrategyInput({ ...previous, ...input });
  if (before && data.kind !== before.kind)
    throw new DataError('No se puede cambiar el tipo de estrategia');
  if (
    before?.kind === 'indicator' &&
    (data.unit !== before.unit || data.resourceType !== before.resourceType)
  ) {
    const found = await tx.execute({
      sql: 'SELECT id FROM faro_strategy WHERE indicator_id=? LIMIT 1',
      args: [before.id],
    });
    if (found.rows.length)
      throw new DataError(
        'Este indicador ya tiene mediciones. Crea otro para cambiar su unidad o fuente.',
        409,
      );
  }
  if (before?.kind === 'measurement' && before.indicatorId !== data.indicatorId)
    throw new DataError('Una medición conserva su indicador original', 409);
  const now = new Date().toISOString();
  const item: StrategyItem = {
    ...data,
    id: before?.id ?? randomUUID(),
    createdAt: before?.createdAt ?? now,
    updatedAt: now,
  };
  if (item.kind === 'measurement') {
    const indicator = await getStrategy(tx, item.indicatorId!);
    if (!indicator || indicator.kind !== 'indicator')
      throw new DataError('El indicador no existe', 409);
    if (item.unit && item.unit !== indicator.unit)
      throw new DataError('La unidad de la medición no coincide con su indicador', 409);
    item.unit = indicator.unit;
  }
  await validateStrategy(tx, item, undefined, undefined, before?.stage !== 'applied');
  await persistStrategy(tx, item);
  await auditStrategy(tx, before, item);
  return item;
}
export async function deleteStrategy(tx: Executor, id: string): Promise<void> {
  const item = await getStrategy(tx, id);
  if (!item) throw new DataError('El registro ya no existe', 404);
  await tx.execute({
    sql: "DELETE FROM faro_strategy_record_links WHERE strategy_id=? AND relation='context'",
    args: [id],
  });
  await auditStrategy(tx, item, null);
  await tx.execute({ sql: 'DELETE FROM faro_strategy WHERE id=?', args: [id] });
}
export async function strategyHistory(
  tx: Executor,
  id?: string,
  offset = 0,
  limit = 50,
): Promise<StrategyHistory[]> {
  const result = await tx.execute(
    id
      ? {
          sql: 'SELECT data FROM faro_strategy_history WHERE item_id=? ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?',
          args: [id, limit, offset],
        }
      : 'SELECT data FROM faro_strategy_history ORDER BY occurred_at,id',
  );
  return result.rows.map((r) => decode<StrategyHistory>(r.data));
}
