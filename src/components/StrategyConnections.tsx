import type { FaroRecord, FaroSnapshot, RecordInput } from '../lib/types';
import { RESOURCE_TYPES, resourceLabels } from '../domains/strategy/types';
export function StrategyConnections({
  snapshot,
  value,
  onChange,
}: {
  snapshot: FaroSnapshot;
  value: Partial<RecordInput>;
  onChange: (value: Partial<RecordInput>) => void;
}) {
  return (
    <div className="form-grid strategy-connections">
      {(['vision', 'key'] as const).map((kind) => {
        const field = kind === 'vision' ? 'visionIds' : 'powerKeyIds';
        const selected = value[field] ?? [];
        const choices = (snapshot.strategy ?? []).filter(
          (i) => i.kind === kind && (i.status !== 'archived' || selected.includes(i.id)),
        );
        return (
          <fieldset className="field" key={kind}>
            <legend>
              {kind === 'vision' ? 'Visiones relacionadas' : 'Claves de poder relacionadas'}
            </legend>
            {choices.length ? (
              <div className="relation-options">
                {choices.map((item) => (
                  <label className="relation-option" key={item.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={(e) =>
                        onChange({
                          [field]: e.target.checked
                            ? [...selected, item.id]
                            : selected.filter((id) => id !== item.id),
                        })
                      }
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            ) : (
              <small className="muted">
                Puedes crearlas en <a href="/north">Mi norte</a>.
              </small>
            )}
          </fieldset>
        );
      })}
      <fieldset className="field">
        <legend>Fuentes que espero cuidar o desarrollar</legend>
        {RESOURCE_TYPES.map((type) => (
          <label className="checkbox-field" key={type}>
            <input
              type="checkbox"
              checked={value.resourceTypes?.includes(type) ?? false}
              onChange={(e) =>
                onChange({
                  resourceTypes: e.target.checked
                    ? [...(value.resourceTypes ?? []), type]
                    : (value.resourceTypes ?? []).filter((t) => t !== type),
                })
              }
            />
            {resourceLabels[type]}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
export function StrategyContext({
  record,
  snapshot,
}: {
  record: Partial<FaroRecord>;
  snapshot: FaroSnapshot;
}) {
  const visions = (snapshot.strategy ?? []).filter(
    (i) =>
      i.kind === 'vision' &&
      (record.visionIds?.includes(i.id) || Boolean(record.id && i.recordIds?.includes(record.id))),
  );
  const keys = (snapshot.strategy ?? []).filter(
    (i) =>
      i.kind === 'key' &&
      (record.powerKeyIds?.includes(i.id) ||
        Boolean(record.id && i.recordIds?.includes(record.id))),
  );
  if (!visions.length && !keys.length && !record.resourceTypes?.length && !record.purpose)
    return null;
  return (
    <div className="stack strategy-context">
      {record.purpose && (
        <p className="preserve-lines">
          <strong>Para qué: </strong>
          {record.purpose}
        </p>
      )}
      {visions.length > 0 && (
        <div className="inline">
          <span className="muted small">Visión</span>
          {visions.map((i) => (
            <a className="text-link" key={i.id} href={`/north?item=${i.id}`}>
              {i.name}
            </a>
          ))}
        </div>
      )}
      {keys.length > 0 && (
        <div className="inline">
          <span className="muted small">Capacidades relacionadas</span>
          {keys.map((i) => (
            <a className="text-link" key={i.id} href={`/north?item=${i.id}`}>
              {i.name}
            </a>
          ))}
        </div>
      )}
      {Boolean(record.resourceTypes?.length) && (
        <div className="inline">
          <span className="muted small">Fuentes relacionadas</span>
          {record.resourceTypes?.map((type) => (
            <a className="badge" key={type} href="/north?tab=resources">
              {resourceLabels[type]}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
