import type { FaroSnapshot } from '../../lib/types';
import { compactRecord, metadataSnapshot } from '../data/views';
import type { StrategyItem } from './types';
export function strategyMetadata(items: StrategyItem[]): StrategyItem[] {
  return items
    .filter((i) => ['vision', 'key', 'indicator'].includes(i.kind))
    .map((i) => ({
      id: i.id,
      kind: i.kind,
      name: i.name,
      description: '',
      status: i.status,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      stage: i.stage,
      resourceTypes: i.resourceTypes,
      visionIds: i.visionIds,
      recordIds: i.recordIds,
    }));
}
export function northView(snapshot: FaroSnapshot) {
  const all = snapshot.strategy ?? [];
  const definitions = all.filter((i) => i.kind !== 'measurement' && i.kind !== 'review');
  const reviews = all
    .filter((i) => i.kind === 'review')
    .sort(
      (a, b) => (b.reviewDay ?? '').localeCompare(a.reviewDay ?? '') || b.id.localeCompare(a.id),
    )
    .slice(0, 20);
  const indicators = definitions
    .filter((i) => i.kind === 'indicator')
    .map((indicator) => {
      const measurements = all
        .filter(
          (i) =>
            i.kind === 'measurement' &&
            i.indicatorId === indicator.id &&
            i.status === 'active' &&
            i.occurredAt! <= snapshot.generatedAt,
        )
        .sort(
          (a, b) =>
            b.occurredAt!.localeCompare(a.occurredAt!) ||
            b.createdAt.localeCompare(a.createdAt) ||
            b.id.localeCompare(a.id),
        );
      const latest = measurements[0];
      const assessment =
        latest?.value === undefined
          ? 'Sin mediciones'
          : indicator.minimum !== undefined && latest.value < indicator.minimum
            ? 'Por debajo de tu mínimo'
            : indicator.maximum !== undefined && latest.value > indicator.maximum
              ? 'Por encima de tu máximo'
              : indicator.minimum !== undefined || indicator.maximum !== undefined
                ? 'Dentro de tus referencias'
                : 'Sin rango definido';
      return { indicator, latest, count: measurements.length, assessment };
    });
  const ids = new Set([...definitions, ...reviews].flatMap((i) => i.recordIds ?? []));
  const context = snapshot.records
    .filter((r) => ids.has(r.id) || r.visionIds?.length || r.powerKeyIds?.length)
    .map((r) => compactRecord(r));
  return {
    items: [...definitions, ...reviews],
    reviewTotal: all.filter((i) => i.kind === 'review').length,
    indicators,
    context,
    snapshot: metadataSnapshot(snapshot),
  };
}
export type NorthView = ReturnType<typeof northView>;
