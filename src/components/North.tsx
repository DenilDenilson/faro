import { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, History, Archive, Trash2, Compass, Target, BookOpen } from 'lucide-react';
import type { NorthView } from '../domains/strategy';
import type {
  StrategyInput,
  StrategyItem,
  StrategyKind,
  StrategyHistory,
  ResourceType,
} from '../domains/strategy/types';
import { RESOURCE_TYPES, resourceLabels } from '../domains/strategy/types';
import type { EntityType, FaroSnapshot } from '../lib/types';
import { apiRequest, formatDate, localDateTime, zonedInputToIso } from '../lib/client';
import { addDays, startOfWeek } from '../domains/analytics/dates';
import { Dialog, ConfirmDelete } from './ui/dialog';
import { useRecordChoices, entityLabels } from './RecordForm';
const labels: Record<StrategyKind, string> = {
  vision: 'Visión',
  key: 'Clave de poder',
  indicator: 'Indicador',
  measurement: 'Medición',
  review: 'Revisión de rumbo',
};
const stages = {
  exploring: 'Por explorar',
  practicing: 'En práctica',
  applied: 'Aplicada en situaciones registradas',
};
const historyLabels: Partial<Record<keyof StrategyInput, string>> = {
  name: 'Nombre',
  description: 'Descripción',
  purpose: 'Motivos',
  values: 'Valores',
  boundaries: 'Límites',
  horizon: 'Horizonte',
  reviewDate: 'Fecha de revisión',
  stage: 'Etapa',
  evidence: 'Ejemplos de aplicación',
  requiredResources: 'Recursos necesarios',
  resourceType: 'Fuente',
  unit: 'Unidad',
  minimum: 'Mínimo',
  maximum: 'Máximo',
  value: 'Valor observado',
  occurredAt: 'Fecha de observación',
  reviewPeriod: 'Período de revisión',
  reviewDay: 'Día de revisión',
  reflections: 'Rumbo',
  resourceReview: 'Recursos',
  capabilityReview: 'Capacidades',
  decisions: 'Decisiones',
  nextPriorities: 'Próximas prioridades',
  status: 'Estado',
};
const inputFor = (item: StrategyItem): StrategyInput => {
  const { id: _id, createdAt: _c, updatedAt: _u, ...input } = item;
  return input;
};
function RecordPicker({
  snapshot,
  selected,
  onChange,
}: {
  snapshot: FaroSnapshot;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [kind, setKind] = useState<EntityType>('goals');
  const [query, setQuery] = useState('');
  const choices = useRecordChoices(kind, true, query, selected, snapshot.records);
  return (
    <fieldset className="field">
      <legend>Registros relacionados y ejemplos de aplicación</legend>
      <div className="form-grid">
        <label className="field">
          Buscar en
          <select
            aria-label="Buscar en"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as EntityType);
              setQuery('');
            }}
          >
            {(
              [
                'goals',
                'areas',
                'interests',
                'habits',
                'projects',
                'activities',
                'learnings',
              ] as const
            ).map((type) => (
              <option key={type} value={type}>
                {entityLabels[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Buscar registro
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="También puedes buscar registros antiguos"
          />
        </label>
      </div>
      {choices.loading && <p className="muted small">Buscando…</p>}
      {choices.error && (
        <p role="alert" className="field-error">
          {choices.error}
        </p>
      )}
      <div className="relation-options">
        {choices.options.map((item) => (
          <label className="relation-option" key={item.id}>
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, item.id]
                    : selected.filter((id) => id !== item.id),
                )
              }
            />
            <span>
              {item.name}
              <small className="muted"> · {entityLabels[item.type]}</small>
            </span>
          </label>
        ))}
      </div>
      {!choices.loading && !choices.options.length && (
        <p className="muted small">
          No hay coincidencias. Los vínculos seleccionados se conservan al cambiar de categoría.
        </p>
      )}
    </fieldset>
  );
}
export default function North({ initialView }: { initialView: NorthView }) {
  const [view, setView] = useState(initialView);
  const [tab, setTab] = useState('vision');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<StrategyInput>();
  const [editId, setEditId] = useState<string>();
  const [dateInput, setDateInput] = useState('');
  const [selected, setSelected] = useState<StrategyItem>();
  const [history, setHistory] = useState<StrategyHistory[]>([]);
  const [historyMore, setHistoryMore] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const seq = useRef(0);
  const [deleting, setDeleting] = useState<StrategyItem>();
  const [measurementParent, setMeasurementParent] = useState<StrategyItem>();
  const [measurements, setMeasurements] = useState<StrategyItem[]>([]);
  const [measurementTotal, setMeasurementTotal] = useState(0);
  const [measurementLoading, setMeasurementLoading] = useState(false);
  const timezone = view.snapshot.settings.timezone;
  const all = view.items;
  const visible = all.filter((i) => showArchived || i.status !== 'archived');
  const update = <K extends keyof StrategyInput>(field: K, value: StrategyInput[K]) =>
    setDraft((d) => (d ? { ...d, [field]: value } : d));
  useEffect(() => {
    setReady(true);
    const params = new URLSearchParams(window.location.search);
    const value = params.get('tab');
    if (value && ['vision', 'resources', 'keys', 'reviews'].includes(value)) setTab(value);
    const id = params.get('item');
    if (id) void openItem(id);
  }, []);
  async function refresh() {
    setView(await apiRequest<NorthView>('/api/strategy'));
  }
  async function openItem(id: string) {
    const request = ++seq.current;
    setError('');
    setHistoryBusy(true);
    try {
      const result = await apiRequest<{ item: StrategyItem; history: StrategyHistory[] }>(
        `/api/strategy?id=${encodeURIComponent(id)}`,
      );
      if (request !== seq.current) return;
      setSelected(result.item);
      setHistory(result.history);
      setHistoryMore(result.history.length === 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir.');
    } finally {
      if (request === seq.current) setHistoryBusy(false);
    }
  }
  function edit(item: StrategyItem) {
    setSelected(undefined);
    setEditId(item.id);
    setDraft(inputFor(item));
    setDateInput(localDateTime(item.occurredAt ?? new Date().toISOString(), timezone));
    setError('');
  }
  function create(kind: StrategyKind, patch: Partial<StrategyInput> = {}) {
    setEditId(undefined);
    setDraft({
      kind,
      name: kind === 'review' ? 'Revisión de rumbo' : kind === 'measurement' ? 'Medición' : '',
      description: '',
      status: 'active',
      ...(kind === 'key' ? { stage: 'exploring' as const } : {}),
      ...(kind === 'review'
        ? {
            reviewPeriod: 'monthly' as const,
            reviewDay: localDateTime(new Date().toISOString(), timezone).slice(0, 10),
          }
        : {}),
      ...patch,
    });
    setDateInput(localDateTime(new Date().toISOString(), timezone));
    setError('');
  }
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const data = {
        ...draft,
        ...(draft.kind === 'measurement'
          ? { occurredAt: zonedInputToIso(dateInput, timezone) }
          : {}),
      };
      const nullable = Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, value === undefined ? null : value]),
      );
      await apiRequest('/api/strategy', 'POST', { id: editId, data: nullable });
      await refresh();
      setDraft(undefined);
      setMessage('Guardado. El historial conserva tus cambios.');
      if (measurementParent) await showMeasurements(measurementParent);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }
  async function archive(item: StrategyItem) {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/api/strategy', 'POST', {
        id: item.id,
        data: { status: item.status === 'archived' ? 'active' : 'archived' },
      });
      await refresh();
      setSelected(undefined);
      setMessage(item.status === 'archived' ? 'Registro reactivado.' : 'Registro archivado.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo archivar.');
    } finally {
      setBusy(false);
    }
  }
  async function showMeasurements(indicator: StrategyItem, offset = 0) {
    setMeasurementParent(indicator);
    if (offset === 0) {
      setMeasurements([]);
      setMeasurementTotal(0);
    }
    setMeasurementLoading(true);
    setError('');
    try {
      const result = await apiRequest<{ records: StrategyItem[]; total: number }>(
        `/api/strategy?indicator=${indicator.id}&offset=${offset}`,
      );
      setMeasurements(offset ? [...measurements, ...result.records] : result.records);
      setMeasurementTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo consultar.');
    } finally {
      setMeasurementLoading(false);
    }
  }
  const notice = error && (
    <p className="field-error" role="alert">
      {error}
    </p>
  );
  const text = (
    field:
      | 'description'
      | 'purpose'
      | 'values'
      | 'boundaries'
      | 'evidence'
      | 'requiredResources'
      | 'reflections'
      | 'resourceReview'
      | 'capabilityReview'
      | 'decisions'
      | 'nextPriorities',
    label: string,
    rows = 3,
  ) => (
    <label className="field" key={field}>
      {label}
      <textarea
        rows={rows}
        maxLength={20000}
        value={String(draft?.[field] ?? '')}
        onChange={(e) => update(field, e.target.value)}
      />
    </label>
  );
  const strategies = (kind: 'vision' | 'key', field: 'visionIds' | 'keyIds', label: string) => (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="relation-options">
        {all
          .filter(
            (i) =>
              i.kind === kind &&
              i.id !== editId &&
              (i.status !== 'archived' || draft?.[field]?.includes(i.id)),
          )
          .map((i) => (
            <label className="relation-option" key={i.id}>
              <input
                type="checkbox"
                checked={draft?.[field]?.includes(i.id) ?? false}
                onChange={(e) =>
                  update(
                    field,
                    e.target.checked
                      ? [...(draft?.[field] ?? []), i.id]
                      : (draft?.[field] ?? []).filter((id) => id !== i.id),
                  )
                }
              />
              {i.name}
            </label>
          ))}
      </div>
      {!all.some((i) => i.kind === kind) && (
        <small className="muted">
          Todavía no has creado {kind === 'vision' ? 'visiones' : 'claves'}.
        </small>
      )}
    </fieldset>
  );
  const itemCard = (item: StrategyItem) => (
    <article className="card record-card" key={item.id}>
      <div className="section-heading">
        <button
          className="text-link record-title"
          disabled={!ready || busy}
          onClick={() => void openItem(item.id)}
        >
          {item.name}
        </button>
        <span className="badge">
          {item.status === 'archived'
            ? 'Archivado'
            : item.status === 'paused'
              ? 'En pausa'
              : item.kind === 'key'
                ? stages[item.stage ?? 'exploring']
                : 'Activo'}
        </span>
      </div>
      {item.description && <p className="preserve-lines">{item.description}</p>}
      {item.purpose && (
        <p className="muted">
          <strong>Para qué: </strong>
          {item.purpose}
        </p>
      )}
      {item.kind === 'review' && (
        <p className="muted small">
          {formatDate(item.reviewDay, timezone)} ·{' '}
          {item.reviewPeriod === 'quarterly'
            ? 'Trimestral'
            : item.reviewPeriod === 'monthly'
              ? 'Mensual'
              : 'Personalizada'}
        </p>
      )}
      {item.resourceTypes?.length ? (
        <div className="inline">
          {item.resourceTypes.map((t) => (
            <span className="badge" key={t}>
              {resourceLabels[t]}
            </span>
          ))}
        </div>
      ) : null}
      <div className="button-row">
        <button className="button" disabled={!ready || busy} onClick={() => edit(item)}>
          <Pencil size={14} />
          Editar
        </button>
        <button
          className="button subtle"
          disabled={!ready || busy}
          onClick={() => void openItem(item.id)}
        >
          <History size={14} />
          Detalle e historial
        </button>
      </div>
    </article>
  );
  return (
    <div className="stack north-view" aria-busy={busy}>
      <div className="north-intro">
        <Compass size={24} />
        <p>
          Conecta la vida que quieres construir con tus objetivos, los recursos que cuidas y las
          capacidades que desarrollas.
        </p>
      </div>
      <div className="north-tabs" role="group" aria-label="Secciones de Mi norte">
        {[
          ['vision', 'Visión'],
          ['resources', 'Fuentes de poder'],
          ['keys', 'Claves de poder'],
          ['reviews', 'Revisión de rumbo'],
        ].map(([value, label]) => (
          <button
            className={`button ${tab === value ? 'button-primary' : ''}`}
            disabled={!ready || busy}
            aria-pressed={tab === value}
            key={value}
            onClick={() => {
              setTab(value);
              setError('');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {notice}
      <p className={message ? 'muted small' : 'sr-only'} role="status" aria-live="polite">
        {message}
      </p>
      <label className="checkbox-field">
        <input
          disabled={!ready}
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Mostrar archivados
      </label>
      {tab === 'vision' && (
        <>
          <div className="section-heading">
            <div>
              <h2>La vida que quieres construir</h2>
              <p className="muted">
                Tu visión puede evolucionar. Guarda tus motivos, valores y límites y revisa sus
                cambios cuando lo necesites.
              </p>
            </div>
            <button
              className="button button-primary"
              disabled={!ready || busy}
              onClick={() => create('vision')}
            >
              <Plus size={15} />
              Crear visión
            </button>
          </div>
          <div className="record-grid">
            {visible.filter((i) => i.kind === 'vision').map(itemCard)}
          </div>
          {!visible.some((i) => i.kind === 'vision') && (
            <div className="card empty-state">
              <h3>Escribe tu norte con tus propias palabras</h3>
              <p>
                Qué quieres experimentar, qué quieres cambiar y por qué te importa. Puedes
                relacionarlo con áreas y objetivos que ya tienes.
              </p>
            </div>
          )}
          <a href="/goals" className="button">
            <Target size={15} />
            Ver y conectar mis objetivos
          </a>
        </>
      )}
      {tab === 'resources' && (
        <>
          <p className="muted">
            Elige qué observar y cuáles son tus referencias personales. La disponibilidad de tiempo
            se registra expresamente.
          </p>
          <div className="north-resource-grid">
            {RESOURCE_TYPES.map((type) => (
              <section className="card stack" key={type}>
                <div className="section-heading">
                  <h2>{resourceLabels[type]}</h2>
                  <button
                    className="button"
                    disabled={!ready || busy}
                    onClick={() => create('indicator', { resourceType: type })}
                  >
                    <Plus size={14} />
                    Añadir indicador
                  </button>
                </div>
                <p className="muted small">
                  {type === 'body'
                    ? 'Bienestar y capacidades físicas que decidas observar.'
                    : type === 'money'
                      ? 'Reservas y compromisos que quieras registrar de forma resumida.'
                      : 'Disponibilidad y compromisos que tú declares para organizar tu semana.'}
                </p>
                {view.indicators
                  .filter(
                    (s) =>
                      s.indicator.resourceType === type &&
                      (showArchived || s.indicator.status !== 'archived'),
                  )
                  .map((s) => (
                    <article className="north-indicator" key={s.indicator.id}>
                      <button
                        className="text-link"
                        disabled={busy || !ready}
                        onClick={() => void openItem(s.indicator.id)}
                      >
                        {s.indicator.name}
                      </button>
                      <p className="north-value">
                        {s.latest?.value !== undefined
                          ? `${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 4 }).format(s.latest.value)} ${s.indicator.unit}`
                          : 'Sin mediciones'}
                      </p>
                      <p className="muted small">
                        {s.latest
                          ? `${formatDate(s.latest.occurredAt, timezone, true)} · ${s.assessment}`
                          : 'Añade una observación cuando quieras.'}
                      </p>
                      {(s.indicator.minimum !== undefined || s.indicator.maximum !== undefined) && (
                        <p className="muted small">
                          Tus referencias:{' '}
                          {s.indicator.minimum !== undefined
                            ? `mínimo ${s.indicator.minimum} ${s.indicator.unit}`
                            : ''}
                          {s.indicator.minimum !== undefined && s.indicator.maximum !== undefined
                            ? ' · '
                            : ''}
                          {s.indicator.maximum !== undefined
                            ? `máximo ${s.indicator.maximum} ${s.indicator.unit}`
                            : ''}
                        </p>
                      )}
                      <div className="button-row">
                        <button
                          className="button"
                          disabled={!ready || busy}
                          onClick={() =>
                            create('measurement', {
                              indicatorId: s.indicator.id,
                              name: `Medición: ${s.indicator.name}`,
                            })
                          }
                        >
                          Registrar medición
                        </button>
                        <button
                          className="text-link"
                          disabled={!ready || busy}
                          onClick={() => void showMeasurements(s.indicator)}
                        >
                          Ver mediciones
                        </button>
                      </div>
                    </article>
                  ))}
              </section>
            ))}
          </div>
        </>
      )}
      {tab === 'keys' && (
        <>
          <div className="section-heading">
            <div>
              <h2>Conocimientos y capacidades aplicables</h2>
              <p className="muted">
                Relaciona lo que quieres saber hacer con tus objetivos y guarda ejemplos de
                aplicación.
              </p>
            </div>
            <button
              className="button button-primary"
              disabled={!ready || busy}
              onClick={() => create('key')}
            >
              <Plus size={15} />
              Crear clave de poder
            </button>
          </div>
          <div className="record-grid">{visible.filter((i) => i.kind === 'key').map(itemCard)}</div>
          {!visible.some((i) => i.kind === 'key') && (
            <div className="card empty-state">
              <h3>¿Qué necesitas aprender a hacer?</h3>
              <p>Describe una capacidad, para qué te sirve y cómo quieres ponerla en práctica.</p>
            </div>
          )}
          <a href="/learnings" className="button">
            <BookOpen size={15} />
            Ver mis aprendizajes
          </a>
        </>
      )}
      {tab === 'reviews' && (
        <>
          <div className="section-heading">
            <div>
              <h2>Revisar tu rumbo</h2>
              <p className="muted">
                Decide qué mantener, ajustar o pausar en tu visión, objetivos y recursos.
              </p>
            </div>
            <button
              className="button button-primary"
              disabled={!ready || busy}
              onClick={() => create('review')}
            >
              <Plus size={15} />
              Nueva revisión de rumbo
            </button>
          </div>
          <div className="button-row">
            <a className="button" href="/reviews">
              Revisiones semanales
            </a>
            <a className="button" href="/attention">
              Planificar mi semana
            </a>
          </div>
          <div className="record-grid">
            {visible.filter((i) => i.kind === 'review').map(itemCard)}
          </div>
          {view.reviewTotal > all.filter((i) => i.kind === 'review').length && (
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const next = await apiRequest<{ records: StrategyItem[]; total: number }>(
                    `/api/strategy?kind=review&offset=${all.filter((i) => i.kind === 'review').length}`,
                  );
                  setView({ ...view, items: [...all, ...next.records], reviewTotal: next.total });
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'No se pudo consultar.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Cargar revisiones anteriores
            </button>
          )}
        </>
      )}
      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (!open && !busy) setDraft(undefined);
        }}
        title={`${editId ? 'Editar' : 'Crear'} ${draft ? labels[draft.kind].toLocaleLowerCase('es') : ''}`}
        description="Guarda tus decisiones y observaciones. Los cambios se conservan en el historial."
      >
        {draft && (
          <form className="stack" onSubmit={save}>
            <label className="field">
              Nombre
              <input
                autoFocus
                required
                maxLength={200}
                value={draft.name}
                onChange={(e) => update('name', e.target.value)}
              />
            </label>
            {draft.kind !== 'measurement' && (
              <label className="field">
                Estado
                <select
                  value={draft.status}
                  onChange={(e) => update('status', e.target.value as StrategyInput['status'])}
                >
                  <option value="active">Activo</option>
                  <option value="paused">En pausa</option>
                  <option value="archived">Archivado</option>
                </select>
              </label>
            )}
            {draft.kind === 'vision' && (
              <>
                {text('description', 'Cómo quiero vivir')}
                {text('purpose', 'Por qué me importa')}
                {text('values', 'Valores que quiero cultivar')}
                {text('boundaries', 'Límites y condiciones que quiero respetar')}
                <label className="field">
                  Horizonte (opcional)
                  <input
                    maxLength={200}
                    value={draft.horizon ?? ''}
                    onChange={(e) => update('horizon', e.target.value)}
                  />
                </label>
                <label className="field">
                  Volver a revisar el (opcional)
                  <input
                    type="date"
                    value={draft.reviewDate ?? ''}
                    onChange={(e) => update('reviewDate', e.target.value || undefined)}
                  />
                </label>
              </>
            )}
            {draft.kind === 'key' && (
              <>
                {text('description', 'Qué quiero saber hacer')}
                {text('purpose', 'Para qué me sirve')}
                <label className="field">
                  Etapa
                  <select
                    value={draft.stage ?? 'exploring'}
                    onChange={(e) => update('stage', e.target.value as StrategyInput['stage'])}
                  >
                    {Object.entries(stages).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {text('evidence', 'Ejemplos de aplicación y lo que aprendí')}
                {strategies('vision', 'visionIds', 'Visiones relacionadas')}
                {strategies('key', 'keyIds', 'Claves relacionadas')}
                {text('requiredResources', 'Recursos que necesito reservar')}
              </>
            )}
            {draft.kind === 'indicator' && (
              <>
                <div className="form-grid">
                  <label className="field">
                    Fuente
                    <select
                      required
                      value={draft.resourceType ?? ''}
                      onChange={(e) => update('resourceType', e.target.value as ResourceType)}
                    >
                      {RESOURCE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {resourceLabels[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Unidad
                    <input
                      required
                      maxLength={100}
                      placeholder="horas, S/, repeticiones…"
                      value={draft.unit ?? ''}
                      onChange={(e) => update('unit', e.target.value)}
                    />
                  </label>
                </div>
                {text('description', 'Qué representa este indicador')}
                <div className="form-grid">
                  {(['minimum', 'maximum'] as const).map((field, i) => (
                    <label className="field" key={field}>
                      {i === 0 ? 'Mínimo personal (opcional)' : 'Máximo personal (opcional)'}
                      <input
                        type="number"
                        step="any"
                        min={-1e12}
                        max={1e12}
                        value={draft[field] ?? ''}
                        onChange={(e) =>
                          update(field, e.target.value === '' ? undefined : Number(e.target.value))
                        }
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
            {draft.kind === 'measurement' && (
              <>
                <p className="muted small">
                  Unidad: {draft.unit ?? all.find((i) => i.id === draft.indicatorId)?.unit}
                </p>
                <label className="field">
                  Valor observado
                  <input
                    required
                    type="number"
                    step="any"
                    min={-1e12}
                    max={1e12}
                    value={draft.value ?? ''}
                    onChange={(e) =>
                      update('value', e.target.value === '' ? undefined : Number(e.target.value))
                    }
                  />
                </label>
                <label className="field">
                  Fecha y hora ({timezone})
                  <input
                    required
                    type="datetime-local"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                  />
                </label>
                {text('description', 'Notas de esta observación')}
              </>
            )}
            {draft.kind === 'review' && (
              <>
                <div className="form-grid">
                  <label className="field">
                    Período
                    <select
                      value={draft.reviewPeriod ?? 'monthly'}
                      onChange={(e) =>
                        update('reviewPeriod', e.target.value as StrategyInput['reviewPeriod'])
                      }
                    >
                      <option value="monthly">Mensual</option>
                      <option value="quarterly">Trimestral</option>
                      <option value="custom">Personalizado</option>
                    </select>
                  </label>
                  <label className="field">
                    Día de revisión
                    <input
                      required
                      type="date"
                      value={draft.reviewDay ?? ''}
                      onChange={(e) => update('reviewDay', e.target.value || undefined)}
                    />
                  </label>
                </div>
                {strategies('vision', 'visionIds', 'Visiones revisadas')}
                {strategies('key', 'keyIds', 'Claves revisadas')}
                {text('reflections', 'Qué mantengo o ajusto de mi rumbo')}
                {text('resourceReview', 'Cómo estoy cuidando cuerpo, dinero y tiempo')}
                {text('capabilityReview', 'Qué capacidades puse en práctica')}
                {text('decisions', 'Decisiones')}
                {text('nextPriorities', 'Próximas prioridades')}
              </>
            )}
            {['vision', 'key', 'review'].includes(draft.kind) && (
              <fieldset className="field">
                <legend>Fuentes relacionadas</legend>
                {RESOURCE_TYPES.map((t) => (
                  <label className="checkbox-field" key={t}>
                    <input
                      type="checkbox"
                      checked={draft.resourceTypes?.includes(t) ?? false}
                      onChange={(e) =>
                        update(
                          'resourceTypes',
                          e.target.checked
                            ? [...(draft.resourceTypes ?? []), t]
                            : (draft.resourceTypes ?? []).filter((value) => value !== t),
                        )
                      }
                    />
                    {resourceLabels[t]}
                  </label>
                ))}
              </fieldset>
            )}
            {draft.kind !== 'measurement' && (
              <RecordPicker
                snapshot={view.snapshot}
                selected={draft.recordIds ?? []}
                onChange={(ids) => update('recordIds', ids)}
              />
            )}
            {notice}
            <button className="button button-primary" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </form>
        )}
      </Dialog>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setSelected(undefined);
            seq.current++;
          }
        }}
        title={selected?.name ?? 'Detalle'}
        description="Consulta el contenido actual y el historial de cambios."
      >
        {selected && (
          <div className="stack">
            {selected.kind === 'key' && (
              <span className="badge">{stages[selected.stage ?? 'exploring']}</span>
            )}
            {(
              [
                ['description', selected.kind === 'vision' ? 'Cómo quiero vivir' : 'Descripción'],
                ['purpose', 'Para qué'],
                ['values', 'Valores'],
                ['boundaries', 'Límites y condiciones'],
                ['horizon', 'Horizonte'],
                ['evidence', 'Ejemplos de aplicación'],
                ['requiredResources', 'Recursos necesarios'],
                ['reflections', 'Rumbo'],
                ['resourceReview', 'Recursos'],
                ['capabilityReview', 'Capacidades'],
                ['decisions', 'Decisiones'],
                ['nextPriorities', 'Próximas prioridades'],
              ] as const
            ).map(([field, label]) =>
              selected[field] ? (
                <section key={field}>
                  <h3>{label}</h3>
                  <p className="preserve-lines">{selected[field]}</p>
                </section>
              ) : null,
            )}
            {selected.reviewDate && (
              <p>Volver a revisar el {formatDate(selected.reviewDate, timezone)}</p>
            )}
            {[...(selected.visionIds ?? []), ...(selected.keyIds ?? [])].length > 0 && (
              <section>
                <h3>Visiones y claves relacionadas</h3>
                <div className="stack">
                  {[...(selected.visionIds ?? []), ...(selected.keyIds ?? [])].map((id) => (
                    <button className="text-link" key={id} onClick={() => void openItem(id)}>
                      {all.find((i) => i.id === id)?.name ?? 'Ver registro relacionado'}
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h3>Objetivos, prácticas y aprendizajes relacionados</h3>
              <div className="north-context-list">
                {view.context
                  .filter(
                    (r) =>
                      selected.recordIds?.includes(r.id) ||
                      r.visionIds?.includes(selected.id) ||
                      r.powerKeyIds?.includes(selected.id),
                  )
                  .map((r) => (
                    <a key={r.id} href={`/${r.type}?id=${r.id}`}>
                      {r.name}
                      <small className="muted"> · {entityLabels[r.type]}</small>
                    </a>
                  ))}
              </div>
              <a className="text-link" href="/goals">
                Conectar un objetivo
              </a>
            </section>
            {selected.kind === 'review' && selected.reviewDay && (
              <div className="button-row">
                <a className="button" href={`/attention?week=${startOfWeek(selected.reviewDay)}`}>
                  Ver esta semana
                </a>
                <a
                  className="button"
                  href={`/attention?week=${addDays(startOfWeek(selected.reviewDay), 7)}`}
                >
                  Preparar la próxima semana
                </a>
              </div>
            )}
            <div className="button-row">
              <button className="button" disabled={busy} onClick={() => edit(selected)}>
                <Pencil size={14} />
                Editar
              </button>
              <button className="button" disabled={busy} onClick={() => void archive(selected)}>
                <Archive size={14} />
                {selected.status === 'archived' ? 'Reactivar' : 'Archivar'}
              </button>
              <button
                className="button subtle"
                disabled={busy}
                onClick={() => setDeleting(selected)}
              >
                <Trash2 size={14} />
                Eliminar
              </button>
            </div>
            <details>
              <summary>
                Historial de cambios ({history.length}
                {historyMore ? '+' : ''})
              </summary>
              {history.map((change) => (
                <article className="north-history" key={change.id}>
                  <p className="muted small">
                    {formatDate(change.occurredAt, timezone, true)} ·{' '}
                    {change.before ? 'Actualización' : 'Creación'}
                  </p>
                  {change.before && (
                    <details>
                      <summary>Versión anterior</summary>
                      {Object.entries(historyLabels)
                        .filter(
                          ([field]) => change.before?.[field as keyof StrategyInput] !== undefined,
                        )
                        .map(([field, label]) => (
                          <p className="preserve-lines" key={field}>
                            <strong>{label}: </strong>
                            {field === 'stage' && change.before?.stage
                              ? stages[change.before.stage]
                              : field === 'resourceType' && change.before?.resourceType
                                ? resourceLabels[change.before.resourceType]
                                : field === 'status'
                                  ? { active: 'Activo', paused: 'En pausa', archived: 'Archivado' }[
                                      change.before!.status
                                    ]
                                  : field === 'reviewPeriod' && change.before?.reviewPeriod
                                    ? {
                                        monthly: 'Mensual',
                                        quarterly: 'Trimestral',
                                        custom: 'Personalizado',
                                      }[change.before.reviewPeriod]
                                    : String(change.before?.[field as keyof StrategyInput])}
                          </p>
                        ))}
                    </details>
                  )}
                </article>
              ))}
              {historyMore && (
                <button
                  className="button"
                  disabled={historyBusy}
                  onClick={async () => {
                    setHistoryBusy(true);
                    try {
                      const next = await apiRequest<{ history: StrategyHistory[] }>(
                        `/api/strategy?id=${selected.id}&offset=${history.length}`,
                      );
                      setHistory([...history, ...next.history]);
                      setHistoryMore(next.history.length === 50);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'No se pudo consultar.');
                    } finally {
                      setHistoryBusy(false);
                    }
                  }}
                >
                  Cargar más cambios
                </button>
              )}
            </details>
            {notice}
          </div>
        )}
      </Dialog>
      <Dialog
        open={Boolean(measurementParent) && !draft && !selected}
        onOpenChange={(open) => {
          if (!open) setMeasurementParent(undefined);
        }}
        title={`Mediciones: ${measurementParent?.name ?? ''}`}
        description="Valores que has registrado, con sus fechas y unidad original."
      >
        {measurementParent && (
          <div className="stack">
            {measurementLoading ? (
              <p role="status">Consultando mediciones…</p>
            ) : measurements.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Valor</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {measurements.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDate(item.occurredAt, timezone, true)}</td>
                        <td>
                          {item.value} {item.unit ?? measurementParent.unit}
                          {item.status === 'archived' ? ' · Archivada' : ''}
                        </td>
                        <td>
                          <button className="text-link" onClick={() => edit(item)}>
                            Editar
                          </button>{' '}
                          ·{' '}
                          <button
                            className="text-link"
                            onClick={() => {
                              setMeasurementParent(undefined);
                              void openItem(item.id);
                            }}
                          >
                            Historial
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Todavía no hay mediciones.</p>
            )}
            {measurements.length < measurementTotal && (
              <button
                className="button"
                onClick={() => void showMeasurements(measurementParent, measurements.length)}
              >
                Cargar mediciones anteriores
              </button>
            )}
            {notice}
          </div>
        )}
      </Dialog>
      <ConfirmDelete
        name={deleting?.name ?? ''}
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(undefined);
        }}
        busy={busy}
        error={error}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          setError('');
          try {
            await apiRequest('/api/strategy', 'DELETE', { id: deleting.id });
            await refresh();
            setDeleting(undefined);
            setSelected(undefined);
            setMessage('Registro eliminado. Su historial se conserva.');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'No se pudo eliminar.');
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
