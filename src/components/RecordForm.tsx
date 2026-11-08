import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type SubmitEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import type {
  EntityType,
  FaroRecord,
  FaroSnapshot,
  RecordInput,
  RecordStatus,
  Cadence,
} from '../lib/types';
import { apiRequest, formatMinutes, localDateTime, zonedInputToIso } from '../lib/client';
import { Button } from './ui/button';
import type { WeeklySummary } from '../domains/reviews';

export const entityLabels: Record<EntityType, string> = {
  areas: 'Área',
  interests: 'Interés',
  goals: 'Objetivo',
  habits: 'Hábito',
  projects: 'Proyecto',
  milestones: 'Hito',
  activities: 'Actividad',
  reviews: 'Revisión',
  seasons: 'Temporada',
  learnings: 'Aprendizaje',
  progress: 'Avance',
};
export const statusLabels: Record<RecordStatus, string> = {
  active: 'Activo',
  paused: 'En pausa',
  archived: 'Archivado',
  pending: 'Pendiente',
  in_progress: 'En progreso',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

export function recordInput(record: FaroRecord): RecordInput {
  const { id: _id, type: _type, createdAt: _created, updatedAt: _updated, ...data } = record;
  return data;
}
function initialData(type: EntityType, defaults?: Partial<RecordInput>): RecordInput {
  const now = new Date().toISOString();
  return {
    name: '',
    description: '',
    status: type === 'projects' || type === 'milestones' ? 'pending' : 'active',
    ...(type === 'areas' ? { color: '#227666', icon: 'circle', order: 0 } : {}),
    ...(type === 'interests' ? { priority: 2, frequencyDays: 7 } : {}),
    ...(type === 'habits' ? { cadence: 'weekly' as const, targetCount: 2, intervalDays: 1 } : {}),
    ...(type === 'goals' || type === 'projects' ? { priority: 2 } : {}),
    ...(type === 'activities'
      ? { occurredAt: now, durationMinutes: 30, idempotencyKey: crypto.randomUUID() }
      : {}),
    ...(type === 'learnings' || type === 'progress' ? { occurredAt: now } : {}),
    ...defaults,
  };
}

function Field({
  label,
  hint,
  children,
  wide = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  return (
    <div className="field" style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string; 'aria-describedby'?: string }>, {
            id,
            ...(hint ? { 'aria-describedby': `${id}-help` } : {}),
          })
        : children}
      {hint && (
        <small id={`${id}-help`} className="muted">
          {hint}
        </small>
      )}
    </div>
  );
}

function useRecordChoices(
  kind: EntityType,
  enabled: boolean,
  query: string,
  selectedIds: string[],
  initial: FaroRecord[],
  excludeId?: string,
) {
  const [options, setOptions] = useState<FaroRecord[]>(
    initial.filter((item) => item.type === kind).slice(0, 50),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cache = useRef(new Map(initial.map((item) => [item.id, item])));
  const selection = JSON.stringify(selectedIds);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timeout = window.setTimeout(
      async () => {
        setLoading(true);
        setError('');
        try {
          const params = new URLSearchParams({ type: kind, q: query, limit: '50' });
          const result = await apiRequest<FaroRecord[] | { records: FaroRecord[] }>(
            `/api/records?${params}`,
          );
          const found = (Array.isArray(result) ? result : result.records).filter(
            (item) => item.id !== excludeId,
          );
          for (const item of found) cache.current.set(item.id, item);
          const selected = await Promise.all(
            (JSON.parse(selection) as string[])
              .filter((id) => id !== excludeId)
              .map(async (id) => {
                const cached = cache.current.get(id);
                if (cached) return cached;
                const full = await apiRequest<FaroRecord>(`/api/records/${encodeURIComponent(id)}`);
                cache.current.set(id, full);
                return full;
              }),
          );
          const unique = new Map([...selected, ...found].map((item) => [item.id, item]));
          if (!cancelled) setOptions([...unique.values()]);
        } catch (cause) {
          if (!cancelled)
            setError(
              cause instanceof Error ? cause.message : 'No se pudieron consultar los registros.',
            );
        } finally {
          if (!cancelled) setLoading(false);
        }
      },
      query ? 300 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [kind, enabled, query, selection, excludeId]);
  return { options, loading, error };
}

export default function RecordForm({
  type,
  snapshot,
  record,
  defaults,
  onSave,
  onCancel,
}: {
  type: EntityType;
  snapshot: FaroSnapshot;
  record?: FaroRecord;
  defaults?: Partial<RecordInput>;
  onSave: (input: RecordInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RecordInput>(() =>
    record ? recordInput(record) : initialData(type, defaults),
  );
  const [tagsText, setTagsText] = useState(
    record?.tags?.join(', ') ?? defaults?.tags?.join(', ') ?? '',
  );
  const [referencesText, setReferencesText] = useState(
    record?.references?.join('\n') ?? defaults?.references?.join('\n') ?? '',
  );
  const [activityQuery, setActivityQuery] = useState('');
  const [learningQuery, setLearningQuery] = useState('');
  const activityChoices = useRecordChoices(
    'activities',
    type === 'learnings',
    activityQuery,
    draft.activityId ? [draft.activityId] : [],
    snapshot.records,
  );
  const learningChoices = useRecordChoices(
    'learnings',
    type === 'learnings',
    learningQuery,
    draft.learningIds ?? [],
    snapshot.records,
    record?.id,
  );
  const [reviewSummary, setReviewSummary] = useState<WeeklySummary>();
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = <K extends keyof RecordInput>(field: K, value: RecordInput[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const allowed = (kinds: EntityType[]) =>
    snapshot.records.filter((item) => kinds.includes(item.type) && item.id !== record?.id);
  useEffect(() => {
    if (type !== 'reviews' || !draft.weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(draft.weekStart))
      return;
    let cancelled = false;
    setReviewLoading(true);
    setReviewError('');
    setReviewSummary(undefined);
    apiRequest<{ summary: WeeklySummary }>(
      `/api/reviews/summary?weekStart=${encodeURIComponent(draft.weekStart)}`,
    )
      .then((result) => {
        if (!cancelled) setReviewSummary(result.summary);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setReviewError(
            cause instanceof Error ? cause.message : 'No se pudo consultar el resumen.',
          );
      })
      .finally(() => {
        if (!cancelled) setReviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type, draft.weekStart]);
  const scalar = (field: keyof RecordInput) => String(draft[field] ?? '');
  const number = (
    field:
      | 'priority'
      | 'frequencyDays'
      | 'order'
      | 'durationMinutes'
      | 'targetCount'
      | 'targetMinutes'
      | 'intervalDays'
      | 'targetValue'
      | 'currentValue'
      | 'value',
    value: string,
  ) => {
    update(field, value === '' ? undefined : Number(value));
    if (value && Number(value) > 0 && field === 'targetMinutes') update('targetCount', undefined);
    if (value && Number(value) > 0 && field === 'targetCount') update('targetMinutes', undefined);
  };
  const relations = (
    field:
      | 'interestIds'
      | 'habitIds'
      | 'projectIds'
      | 'goalIds'
      | 'learningIds'
      | 'focusIds'
      | 'maintenanceIds'
      | 'explorationIds',
    kinds: EntityType[],
    label: string,
    required = false,
  ) => {
    const options = allowed(kinds);
    const selected = draft[field] ?? [];
    return (
      <fieldset className="field" style={{ gridColumn: '1 / -1' }}>
        <legend>
          {label}
          {required ? ' *' : ''}
        </legend>
        {options.length ? (
          <div className="relation-options">
            {options.map((option) => (
              <label className="relation-option" key={option.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(option.id)}
                  onChange={(event) =>
                    update(
                      field,
                      event.target.checked
                        ? [...selected, option.id]
                        : selected.filter((id) => id !== option.id),
                    )
                  }
                />
                <span>
                  {option.name}
                  {option.status === 'archived' ? ' · archivado' : ''}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <small className="muted">
            Todavía no hay registros disponibles. Puedes crearlos desde su sección.
          </small>
        )}
      </fieldset>
    );
  };
  const area = (required = false) => (
    <Field label={`Área de vida${required ? ' *' : ''}`}>
      <select
        className="select"
        value={draft.areaId ?? ''}
        required={required}
        onChange={(event) => update('areaId', event.target.value || undefined)}
      >
        <option value="">Elegir área</option>
        {allowed(['areas']).map((option) => (
          <option value={option.id} key={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </Field>
  );
  const priority = (
    <Field label="Prioridad">
      <select
        className="select"
        value={draft.priority ?? 2}
        onChange={(event) => update('priority', Number(event.target.value))}
      >
        <option value={3}>Alta</option>
        <option value={2}>Media</option>
        <option value={1}>Baja</option>
      </select>
    </Field>
  );
  const dateField = (
    field: 'startDate' | 'endDate' | 'weekStart',
    label: string,
    required = false,
  ) => (
    <Field label={label}>
      <input
        className="input"
        type="date"
        value={scalar(field)}
        required={required}
        onChange={(event) => update(field, event.target.value || undefined)}
      />
    </Field>
  );
  const instantField = (
    <Field
      label="Fecha y hora *"
      hint={`Zona horaria: ${snapshot.settings.timezone}. Puedes registrar actividades pasadas.`}
    >
      <input
        className="input"
        type="datetime-local"
        required
        value={localDateTime(
          draft.occurredAt ?? new Date().toISOString(),
          snapshot.settings.timezone,
        )}
        onChange={(event) => {
          try {
            update('occurredAt', zonedInputToIso(event.target.value, snapshot.settings.timezone));
            setError('');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Fecha no válida');
          }
        }}
      />
    </Field>
  );
  const longText = (
    field:
      | 'outcomes'
      | 'reflections'
      | 'achievements'
      | 'difficulties'
      | 'decisions'
      | 'nextPriorities'
      | 'notes',
    label: string,
  ) => (
    <Field label={label} wide>
      <textarea
        className="textarea"
        rows={3}
        value={scalar(field)}
        maxLength={20000}
        onChange={(event) => update(field, event.target.value)}
      />
    </Field>
  );
  const statuses: RecordStatus[] =
    type === 'projects'
      ? ['pending', 'in_progress', 'paused', 'completed', 'cancelled']
      : type === 'goals'
        ? ['active', 'paused', 'completed', 'archived']
        : type === 'milestones'
          ? ['pending', 'completed']
          : type === 'areas'
            ? ['active', 'archived']
            : ['active', 'paused', 'archived'];

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if ((type === 'activities' || type === 'habits') && !draft.interestIds?.length) {
      setError('Selecciona al menos un interés relacionado.');
      return;
    }
    if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) {
      setError('La fecha de fin debe ser posterior o igual a la fecha de inicio.');
      return;
    }
    if (type === 'habits' && draft.cadence === 'custom' && !draft.weekdays?.length) {
      setError('Selecciona los días de la semana de este hábito.');
      return;
    }
    setBusy(true);
    try {
      await onSave({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="stack"
      aria-label={`${record ? 'Editar' : 'Crear'} ${entityLabels[type].toLowerCase()}`}
    >
      <div className="form-grid">
        <Field
          label={`${type === 'activities' ? '¿Qué hiciste?' : type === 'learnings' ? 'Título del descubrimiento' : 'Nombre'} *`}
          wide
        >
          <input
            className="input"
            name="name"
            autoFocus
            required
            maxLength={200}
            value={draft.name}
            placeholder={type === 'interests' ? 'Por ejemplo, robótica' : undefined}
            onChange={(event) => update('name', event.target.value)}
          />
        </Field>
        <Field label={type === 'learnings' ? 'Descripción o resumen' : 'Descripción'} wide>
          <textarea
            className="textarea"
            name="description"
            rows={3}
            maxLength={20000}
            value={draft.description}
            onChange={(event) => update('description', event.target.value)}
          />
        </Field>
        {!['activities', 'reviews', 'learnings', 'progress'].includes(type) && (
          <Field label="Estado">
            <select
              className="select"
              value={draft.status}
              onChange={(event) => update('status', event.target.value as RecordStatus)}
            >
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </Field>
        )}
        {type === 'areas' && (
          <>
            <Field label="Color">
              <input
                type="color"
                className="input"
                value={draft.color ?? '#227666'}
                onChange={(event) => update('color', event.target.value)}
              />
            </Field>
            <Field label="Icono" hint="Elige el símbolo que te ayuda a reconocer esta dimensión.">
              <select
                className="select"
                value={draft.icon ?? 'circle'}
                onChange={(event) => update('icon', event.target.value)}
              >
                <option value="circle">○ General</option>
                <option value="heart">♡ Salud</option>
                <option value="code">⌘ Tecnología</option>
                <option value="book">▤ Conocimiento</option>
                <option value="users">♧ Relaciones</option>
                <option value="music">♫ Arte y cultura</option>
                <option value="leaf">♧ Bienestar</option>
                <option value="sparkles">✧ Exploración</option>
              </select>
            </Field>
            <Field label="Orden de presentación">
              <input
                className="input"
                type="number"
                min={0}
                step={1}
                value={draft.order ?? ''}
                onChange={(event) => number('order', event.target.value)}
              />
            </Field>
          </>
        )}
        {type === 'interests' && (
          <>
            {area(true)}
            {priority}
            <Field
              label="Atender cada cuántos días *"
              hint="Este intervalo guía el radar de atención. Las metas de N sesiones por semana se configuran en Hábitos."
            >
              <input
                className="input"
                type="number"
                min={1}
                max={3650}
                required
                value={draft.frequencyDays ?? ''}
                onChange={(event) => number('frequencyDays', event.target.value)}
              />
            </Field>
          </>
        )}
        {type === 'goals' && (
          <>
            {priority}
            {dateField('startDate', 'Fecha de inicio')}
            {dateField('endDate', 'Fecha objetivo')}
            {longText('outcomes', 'Resultado esperado y criterios de éxito')}
            <Field label="Meta medible (opcional)">
              <input
                className="input"
                type="number"
                min={0.0001}
                step="any"
                value={draft.targetValue ?? ''}
                onChange={(event) => number('targetValue', event.target.value)}
              />
            </Field>
            <Field label="Valor actual">
              <input
                className="input"
                type="number"
                min={0}
                step="any"
                value={draft.currentValue ?? ''}
                onChange={(event) => number('currentValue', event.target.value)}
              />
            </Field>
            <Field label="Unidad">
              <input
                className="input"
                value={draft.unit ?? ''}
                placeholder="libros, km, capítulos…"
                onChange={(event) => update('unit', event.target.value)}
              />
            </Field>
            {relations('interestIds', ['interests'], 'Intereses relacionados')}
            {relations('habitIds', ['habits'], 'Hábitos que contribuyen')}
            {relations('projectIds', ['projects'], 'Proyectos que contribuyen')}
          </>
        )}
        {type === 'habits' && (
          <>
            <Field label="Frecuencia">
              <select
                className="select"
                value={draft.cadence ?? 'weekly'}
                onChange={(event) => update('cadence', event.target.value as Cadence)}
              >
                <option value="daily">Diaria</option>
                <option value="weekly">N veces por semana</option>
                <option value="monthly">N veces por mes</option>
                <option value="interval">Cada N días</option>
                <option value="custom">Días de la semana</option>
              </select>
            </Field>
            {draft.cadence === 'interval' && (
              <Field label="Cada cuántos días">
                <input
                  className="input"
                  type="number"
                  required
                  min={1}
                  max={3650}
                  value={draft.intervalDays ?? ''}
                  onChange={(event) => number('intervalDays', event.target.value)}
                />
              </Field>
            )}
            <Field
              label="Sesiones por período"
              hint="Cuenta sesiones. Al indicar minutos, se utiliza el modo de duración en su lugar."
            >
              <input
                className="input"
                type="number"
                min={1}
                max={1000}
                value={draft.targetCount ?? ''}
                onChange={(event) => number('targetCount', event.target.value)}
              />
            </Field>
            <Field
              label="Minutos por período (opcional)"
              hint="Si defines minutos, el cumplimiento se mide por duración."
            >
              <input
                className="input"
                type="number"
                min={1}
                max={100000}
                value={draft.targetMinutes ?? ''}
                onChange={(event) => number('targetMinutes', event.target.value)}
              />
            </Field>
            {draft.cadence === 'custom' && (
              <fieldset className="field" style={{ gridColumn: '1 / -1' }}>
                <legend>Días de práctica</legend>
                <div className="relation-options">
                  {['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'].map(
                    (day, index) => (
                      <label className="relation-option" key={day}>
                        <input
                          type="checkbox"
                          checked={draft.weekdays?.includes(index) ?? false}
                          onChange={(event) =>
                            update(
                              'weekdays',
                              event.target.checked
                                ? [...(draft.weekdays ?? []), index]
                                : draft.weekdays?.filter((item) => item !== index),
                            )
                          }
                        />
                        {day}
                      </label>
                    ),
                  )}
                </div>
              </fieldset>
            )}
            {relations('interestIds', ['interests'], 'Intereses relacionados', true)}
            {relations('goalIds', ['goals'], 'Objetivos relacionados')}
            {relations('projectIds', ['projects'], 'Proyectos relacionados')}
          </>
        )}
        {type === 'projects' && (
          <>
            {area()}
            {priority}
            {dateField('startDate', 'Fecha de inicio')}
            {dateField('endDate', 'Fecha objetivo')}
            {relations('interestIds', ['interests'], 'Intereses relacionados')}
            {relations('goalIds', ['goals'], 'Objetivos relacionados')}
          </>
        )}
        {type === 'activities' && (
          <>
            {instantField}
            <Field label="Duración en minutos *">
              <input
                className="input"
                type="number"
                min={0.1}
                max={1440}
                step="any"
                required
                value={draft.durationMinutes ?? ''}
                onChange={(event) => number('durationMinutes', event.target.value)}
              />
            </Field>
            {relations('interestIds', ['interests'], 'Intereses relacionados', true)}
            {relations('habitIds', ['habits'], 'Hábitos cumplidos')}
            {relations('projectIds', ['projects'], 'Proyectos relacionados')}
            {relations('goalIds', ['goals'], 'Objetivos relacionados')}
            <p className="muted" style={{ gridColumn: '1 / -1' }}>
              La duración se cuenta una sola vez, aunque relaciones esta sesión con varios
              conceptos.
            </p>
          </>
        )}
        {type === 'reviews' && (
          <>
            {dateField('weekStart', 'Lunes de la semana revisada *', true)}
            <section
              className="card stack"
              style={{ gridColumn: '1 / -1' }}
              aria-label="Resumen de la semana seleccionada"
            >
              <h3>Tu semana de un vistazo</h3>
              {reviewLoading && (
                <p className="muted" role="status">
                  Consultando la semana…
                </p>
              )}
              {reviewError && (
                <p className="field-error" role="alert">
                  {reviewError}
                </p>
              )}
              {reviewSummary && (
                <>
                  <p>
                    {formatMinutes(reviewSummary.totalMinutes)} · {reviewSummary.activityCount}{' '}
                    actividades
                  </p>
                  <p className="muted">
                    {reviewSummary.completedHabits.length} hábitos cumplidos ·{' '}
                    {reviewSummary.projectsWithProgress.length} proyectos con avances ·{' '}
                    {reviewSummary.goalsAttended.length} objetivos atendidos
                  </p>
                  <p className="muted">
                    Áreas sin actividad:{' '}
                    {reviewSummary.unattendedAreas.map((item) => item.name).join(', ') ||
                      (snapshot.records.some((item) => item.type === 'areas')
                        ? 'Todas tus áreas tuvieron actividad'
                        : 'Todavía no hay áreas registradas')}
                  </p>
                </>
              )}
            </section>
            {longText('reflections', 'Reflexiones')}
            {longText('achievements', 'Logros')}
            {longText('difficulties', 'Dificultades')}
            {longText('decisions', 'Decisiones')}
            {longText('nextPriorities', 'Prioridades de la siguiente semana')}
          </>
        )}
        {type === 'seasons' && (
          <>
            {dateField('startDate', 'Inicio de la temporada *', true)}
            {dateField('endDate', 'Fin de la temporada *', true)}
            {relations(
              'focusIds',
              ['areas', 'interests', 'goals', 'projects'],
              'Focos principales',
            )}
            {relations(
              'maintenanceIds',
              ['areas', 'interests', 'goals', 'projects'],
              'Mantenimiento',
            )}
            {relations(
              'explorationIds',
              ['areas', 'interests', 'goals', 'projects'],
              'Exploración',
            )}
          </>
        )}
        {type === 'learnings' && (
          <>
            {instantField}
            {relations('interestIds', ['interests'], 'Intereses relacionados')}
            <Field label="Etiquetas" hint="Separadas por comas.">
              <input
                className="input"
                value={tagsText}
                onChange={(event) => {
                  setTagsText(event.target.value);
                  update(
                    'tags',
                    event.target.value
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  );
                }}
              />
            </Field>
            <Field
              label="Buscar sesión de estudio"
              hint="Busca por nombre para encontrar también sesiones antiguas."
            >
              <input
                className="input"
                type="search"
                value={activityQuery}
                placeholder="Buscar en todas mis sesiones…"
                onChange={(event) => setActivityQuery(event.target.value)}
              />
            </Field>
            <Field
              label="Sesión de estudio relacionada"
              hint={
                activityChoices.loading
                  ? 'Consultando sesiones…'
                  : activityChoices.error || 'Se muestran hasta 50 coincidencias.'
              }
            >
              <select
                className="select"
                value={draft.activityId ?? ''}
                onChange={(event) => update('activityId', event.target.value || undefined)}
              >
                <option value="">Sin sesión asociada</option>
                {activityChoices.options.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Enlaces y referencias" hint="Una dirección https:// por línea." wide>
              <textarea
                className="textarea"
                rows={3}
                value={referencesText}
                onChange={(event) => {
                  setReferencesText(event.target.value);
                  update(
                    'references',
                    event.target.value
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean),
                  );
                }}
              />
            </Field>
            <Field
              label="Buscar aprendizajes relacionados"
              hint="Busca también descubrimientos de años anteriores."
              wide
            >
              <input
                className="input"
                type="search"
                value={learningQuery}
                onChange={(event) => setLearningQuery(event.target.value)}
              />
            </Field>
            <fieldset className="field" style={{ gridColumn: '1 / -1' }}>
              <legend>Aprendizajes relacionados</legend>
              <div className="relation-options">
                {learningChoices.options.map((option) => (
                  <label className="relation-option" key={option.id}>
                    <input
                      type="checkbox"
                      checked={draft.learningIds?.includes(option.id) ?? false}
                      onChange={(event) =>
                        update(
                          'learningIds',
                          event.target.checked
                            ? [...(draft.learningIds ?? []), option.id]
                            : draft.learningIds?.filter((id) => id !== option.id),
                        )
                      }
                    />
                    {option.name}
                  </label>
                ))}
              </div>
              <small className="muted">
                {learningChoices.loading
                  ? 'Consultando aprendizajes…'
                  : learningChoices.error ||
                    'Se muestran hasta 50 coincidencias y tus selecciones.'}
              </small>
            </fieldset>
          </>
        )}
        {(type === 'milestones' || type === 'progress') && (
          <>
            <Field label={type === 'milestones' ? 'Proyecto *' : 'Objetivo o proyecto *'}>
              <select
                className="select"
                required
                value={draft.parentId ?? ''}
                onChange={(event) => update('parentId', event.target.value)}
              >
                <option value="">Elegir</option>
                {allowed(type === 'milestones' ? ['projects'] : ['goals', 'projects']).map(
                  (option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ),
                )}
              </select>
            </Field>
            {type === 'progress' && (
              <>
                {instantField}
                <Field
                  label="Nuevo valor registrado *"
                  hint="Registra una medida real del avance; no se calcula a partir de las horas."
                >
                  <input
                    className="input"
                    type="number"
                    required
                    min={0}
                    step="any"
                    value={draft.value ?? ''}
                    onChange={(event) => number('value', event.target.value)}
                  />
                </Field>
              </>
            )}
            {type === 'milestones' && dateField('endDate', 'Fecha objetivo')}
          </>
        )}
        {longText('notes', 'Notas')}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy
            ? 'Guardando…'
            : record
              ? 'Guardar cambios'
              : `Crear ${entityLabels[type].toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}
