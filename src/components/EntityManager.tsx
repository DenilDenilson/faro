import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Layers3,
  ListFilter,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type { EntityType, FaroRecord, FaroSnapshot, RecordInput } from '../lib/types';
import type { EntityPage, EntitySummary, RecordDetailView } from '../domains/data/views';
import { apiRequest, formatDate, formatMinutes, localDateTime } from '../lib/client';
import { habitProgress } from '../domains/habits';
import { attentionFor } from '../domains/attention';
import { isActivity } from '../domains/analytics/dates';
import {
  allocatedMinutesForArea,
  allocatedMinutesForInterest,
  goalMetric,
  projectMetric,
} from '../domains/analytics';
import RecordForm, { entityLabels, recordInput, statusLabels } from './RecordForm';
import RecordDetail, { relatedRecords } from './RecordDetail';
import { Button } from './ui/button';
import { ConfirmDelete, Dialog } from './ui/dialog';

interface Editor {
  type: EntityType;
  record?: FaroRecord;
  defaults?: Partial<RecordInput>;
}
const plural: Record<EntityType, string> = {
  areas: 'áreas',
  interests: 'intereses',
  goals: 'objetivos',
  habits: 'hábitos',
  projects: 'proyectos',
  milestones: 'hitos',
  activities: 'actividades',
  reviews: 'revisiones',
  seasons: 'temporadas',
  learnings: 'aprendizajes',
  progress: 'avances',
};
const emptyDescriptions: Partial<Record<EntityType, string>> = {
  areas:
    'Comienza por las dimensiones de tu vida: salud, conocimiento, relaciones o las que tengan sentido para ti.',
  interests: 'Cada interés tiene su propio ritmo. Puedes cultivarlo sin crear hábitos o proyectos.',
  goals: 'Define un resultado que quieras alcanzar y cómo reconocerás el avance.',
  habits: 'Elige una práctica recurrente y una frecuencia razonable para tu vida.',
  projects: 'Dale un lugar a tus iniciativas, entregables y sesiones de trabajo.',
  activities: 'Registra algo que realmente hiciste. Unos minutos también cuentan.',
  reviews: 'Haz una pausa para mirar tus avances y decidir qué quieres atender.',
  seasons: 'Define qué cultivar, mantener y explorar durante este período de tu vida.',
  learnings: 'Conserva una idea, un descubrimiento o algo que no quieras olvidar.',
};

export default function EntityManager({
  type,
  snapshot,
  entityPage,
  summaries = {},
  filters = {},
}: {
  type: EntityType;
  snapshot: FaroSnapshot;
  entityPage?: EntityPage;
  summaries?: Record<string, EntitySummary>;
  filters?: Record<string, string>;
}) {
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState(filters.q ?? '');
  const [status, setStatus] = useState(filters.status ?? '');
  const [area, setArea] = useState(filters.area ?? '');
  const [interest, setInterest] = useState(filters.interest ?? '');
  const [from, setFrom] = useState(filters.from ?? '');
  const [to, setTo] = useState(filters.to ?? '');
  const [sort, setSort] = useState(
    filters.sort ??
      (type === 'areas'
        ? 'order'
        : ['activities', 'learnings', 'reviews', 'progress'].includes(type)
          ? 'recent'
          : 'priority'),
  );
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<FaroRecord>();
  const [editor, setEditor] = useState<Editor>();
  const [detailData, setDetailData] = useState<RecordDetailView>();
  const detailSequence = useRef(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [detailPageLoading, setDetailPageLoading] = useState(false);
  const [deleting, setDeleting] = useState<FaroRecord>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(
    Boolean(
      filters.status ||
      filters.area ||
      filters.interest ||
      filters.from ||
      filters.to ||
      filters.sort,
    ),
  );
  const [reordering, setReordering] = useState(false);
  const timezone = snapshot.settings.timezone;
  const ownRecords = snapshot.records.filter((record) => record.type === type);
  const areas = snapshot.records.filter((record) => record.type === 'areas');
  const interests = snapshot.records.filter((record) => record.type === 'interests');
  const statuses = [...new Set(ownRecords.map((record) => record.status))];

  useEffect(() => {
    setReady(true);
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id)
      void loadDetail(
        id,
        snapshot.records.find((record) => record.id === id),
      );
    if (params.get('new') === '1' || (type === 'reviews' && params.has('week'))) {
      const defaults: Partial<RecordInput> = {};
      const interestId = params.get('interest');
      if (interestId && interests.some((item) => item.id === interestId))
        defaults.interestIds = [interestId];
      for (const [parameter, relation, relatedType] of [
        ['habit', 'habitIds', 'habits'],
        ['project', 'projectIds', 'projects'],
        ['goal', 'goalIds', 'goals'],
      ] as const) {
        const relatedId = params.get(parameter);
        const related = snapshot.records.find(
          (item) => item.id === relatedId && item.type === relatedType,
        );
        if (related) {
          defaults[relation] = [related.id];
          if (!defaults.interestIds?.length && related.interestIds?.length)
            defaults.interestIds = [...related.interestIds];
        }
      }
      if (type === 'reviews') {
        const day = localDateTime(snapshot.generatedAt, timezone).slice(0, 10);
        const monday = new Date(`${day}T12:00:00Z`);
        monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
        defaults.weekStart = params.get('week') ?? monday.toISOString().slice(0, 10);
        defaults.name = `Revisión del ${formatDate(defaults.weekStart, timezone)}`;
      }
      setEditor({ type, defaults });
    }
    if (params.get('interest')) setInterest(params.get('interest')!);
    if (params.get('area')) setArea(params.get('area')!);
    // Query parameters initialize this island once; subsequent filters stay local.
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, status, area, interest, from, to, sort]);
  const filtered = useMemo(() => {
    if (entityPage) return entityPage.records;
    const query = search.toLocaleLowerCase('es');
    return snapshot.records
      .filter((record) => {
        if (record.type !== type) return false;
        if (
          query &&
          !`${record.name} ${record.description} ${record.tags?.join(' ') ?? ''} ${record.notes ?? ''}`
            .toLocaleLowerCase('es')
            .includes(query)
        )
          return false;
        if (status && record.status !== status) return false;
        if (
          area &&
          record.areaId !== area &&
          !record.interestIds?.some(
            (id) => snapshot.records.find((item) => item.id === id)?.areaId === area,
          )
        )
          return false;
        if (interest && record.id !== interest && !record.interestIds?.includes(interest))
          return false;
        const day =
          record.weekStart ??
          record.startDate ??
          localDateTime(record.occurredAt ?? record.createdAt, timezone).slice(0, 10);
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      })
      .sort((a, b) =>
        sort === 'name'
          ? a.name.localeCompare(b.name, 'es')
          : sort === 'order'
            ? (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'es')
            : sort === 'priority'
              ? (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name, 'es')
              : (b.occurredAt ?? b.weekStart ?? b.startDate ?? b.createdAt).localeCompare(
                  a.occurredAt ?? a.weekStart ?? a.startDate ?? a.createdAt,
                ),
      );
  }, [
    entityPage,
    snapshot.records,
    type,
    search,
    status,
    area,
    interest,
    from,
    to,
    sort,
    timezone,
  ]);
  const total = entityPage?.total ?? filtered.length;
  const pageSize = entityPage?.limit ?? 12;
  const currentPage = entityPage ? Math.floor(entityPage.offset / pageSize) + 1 : page;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const visible = entityPage ? filtered : filtered.slice((page - 1) * 12, page * 12);

  function create(recordType: EntityType = type, defaults: Partial<RecordInput> = {}) {
    detailSequence.current += 1;
    setDetailLoading(false);
    setSelected(undefined);
    setError('');
    if (recordType === 'reviews' && !defaults.weekStart) {
      const day = localDateTime(snapshot.generatedAt, timezone).slice(0, 10);
      const monday = new Date(`${day}T12:00:00Z`);
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      defaults.weekStart = monday.toISOString().slice(0, 10);
      defaults.name = `Revisión del ${formatDate(defaults.weekStart, timezone)}`;
    }
    setEditor({ type: recordType, defaults });
  }
  async function save(input: RecordInput) {
    if (!editor) return;
    await apiRequest(
      editor.record ? `/api/records/${editor.record.id}` : '/api/records',
      editor.record ? 'PUT' : 'POST',
      { type: editor.type, data: input },
    );
    window.location.assign(
      `/${type}${editor.record ? `?id=${encodeURIComponent(editor.record.id)}` : ''}`,
    );
  }
  async function remove() {
    if (!deleting) return;
    setDeleteBusy(true);
    setError('');
    try {
      await apiRequest(`/api/records/${deleting.id}`, 'DELETE');
      window.location.assign(`/${type}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el registro.');
      setDeleteBusy(false);
    }
  }
  async function moveArea(record: FaroRecord, direction: -1 | 1) {
    const ordered = [...ownRecords].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'es'),
    );
    const index = ordered.findIndex((item) => item.id === record.id);
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= ordered.length) return;
    [ordered[index], ordered[otherIndex]] = [ordered[otherIndex], ordered[index]];
    setReordering(true);
    setError('');
    try {
      for (let position = 0; position < ordered.length; position += 1) {
        const item = ordered[position];
        if (item.order !== position) {
          const full = await apiRequest<FaroRecord>(`/api/records/${item.id}`);
          await apiRequest(`/api/records/${item.id}`, 'PUT', {
            type: 'areas',
            data: { ...recordInput(full), order: position },
          });
        }
      }
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo ordenar.');
      setReordering(false);
    }
  }
  async function beginEdit(record: FaroRecord) {
    setEditLoading(true);
    setError('');
    try {
      const full = await apiRequest<FaroRecord>(`/api/records/${record.id}`);
      setSelected(undefined);
      setEditor({ type: full.type, record: full });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo cargar el registro para editarlo.',
      );
    } finally {
      setEditLoading(false);
    }
  }
  async function loadDetail(
    id: string,
    preview?: FaroRecord,
    offsets?: { activityOffset: number; historyOffset: number },
  ) {
    const sequence = ++detailSequence.current;
    if (offsets) setDetailPageLoading(true);
    else {
      setSelected(preview);
      setDetailData(undefined);
      setDetailLoading(true);
    }
    setError('');
    try {
      const params = new URLSearchParams({
        detail: '1',
        activityOffset: String(offsets?.activityOffset ?? 0),
        historyOffset: String(offsets?.historyOffset ?? 0),
      });
      const result = await apiRequest<RecordDetailView>(
        `/api/records/${encodeURIComponent(id)}?${params}`,
      );
      if (sequence === detailSequence.current) {
        setSelected(result.record);
        setDetailData(result);
        setEditor(undefined);
      }
    } catch (cause) {
      if (sequence === detailSequence.current)
        setError(cause instanceof Error ? cause.message : 'No se pudo cargar el detalle.');
    } finally {
      if (sequence === detailSequence.current) {
        setDetailLoading(false);
        setDetailPageLoading(false);
      }
    }
  }
  function navigateFilters(offset = 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({
      q: search,
      status,
      area,
      interest,
      from,
      to,
      sort,
    }))
      if (value) params.set(key, value);
    if (entityPage) params.set('limit', String(pageSize));
    if (offset) params.set('offset', String(offset));
    window.location.assign(`/${type}${params.size ? `?${params}` : ''}`);
  }
  function closeDetail(open: boolean) {
    if (!open) {
      detailSequence.current += 1;
      setSelected(undefined);
      setDetailLoading(false);
      setDetailPageLoading(false);
      const url = new URL(window.location.href);
      if (url.searchParams.has('id')) {
        url.searchParams.delete('id');
        window.history.replaceState(null, '', `${url.pathname}${url.search}`);
      }
    }
  }
  function openRecord(record: FaroRecord) {
    void loadDetail(record.id, record);
  }
  const hasExisting =
    ownRecords.length > 0 ||
    Boolean(
      filters.q ||
      filters.status ||
      filters.area ||
      filters.interest ||
      filters.from ||
      filters.to ||
      (entityPage?.offset ?? 0) > 0,
    );
  const allMinutes = filtered.reduce(
    (total, item) => total + (item.type === 'activities' ? (item.durationMinutes ?? 0) : 0),
    0,
  );

  return (
    <fieldset
      className="stack"
      disabled={!ready}
      aria-busy={!ready}
      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
    >
      <legend className="sr-only">Gestión de {plural[type]}</legend>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (entityPage) navigateFilters();
        }}
      >
        <div
          className="record-toolbar"
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            className="inline"
            style={{ flex: '1 1 260px', maxWidth: 430, position: 'relative' }}
          >
            <Search size={17} style={{ position: 'absolute', left: 13, color: 'var(--muted)' }} />
            <input
              className="input"
              style={{ paddingLeft: 39, width: '100%' }}
              type="search"
              aria-label={`Buscar ${plural[type]}`}
              placeholder={`Buscar ${plural[type]}…`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="inline">
            {entityPage && (
              <Button type="submit" variant="secondary">
                Buscar
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => setShowFilters(!showFilters)}
              aria-expanded={showFilters}
              aria-controls="record-filters"
            >
              <ListFilter size={16} />
              Filtros
            </Button>
            <Button onClick={() => create()}>
              <Plus size={17} />
              {`Crear ${entityLabels[type].toLowerCase()}`}
            </Button>
          </div>
        </div>
        {showFilters && (
          <div id="record-filters" className="card form-grid">
            <label className="field">
              Estado
              <select
                className="select"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">Todos los estados</option>
                {statuses.map((value) => (
                  <option key={value} value={value}>
                    {statusLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            {!['areas', 'seasons', 'reviews'].includes(type) && (
              <label className="field">
                Área
                <select
                  className="select"
                  value={area}
                  onChange={(event) => setArea(event.target.value)}
                >
                  <option value="">Todas las áreas</option>
                  {areas.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!['areas', 'interests', 'seasons', 'reviews'].includes(type) && (
              <label className="field">
                Interés
                <select
                  className="select"
                  value={interest}
                  onChange={(event) => setInterest(event.target.value)}
                >
                  <option value="">Todos los intereses</option>
                  {interests.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              Desde
              <input
                className="input"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="field">
              Hasta
              <input
                className="input"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
            <label className="field">
              Ordenar
              <select
                className="select"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="priority">Prioridad</option>
                <option value="recent">Más recientes</option>
                <option value="name">Nombre</option>
                {type === 'areas' && <option value="order">Orden personalizado</option>}
              </select>
            </label>
            {entityPage && <Button type="submit">Aplicar filtros</Button>}
            <Button
              variant="ghost"
              onClick={() => {
                if (entityPage) {
                  window.location.assign(`/${type}`);
                  return;
                }
                setStatus('');
                setArea('');
                setInterest('');
                setFrom('');
                setTo('');
                setSearch('');
              }}
            >
              Limpiar filtros
            </Button>
          </div>
        )}
      </form>
      {(detailLoading || editLoading) && !selected && (
        <p className="muted" role="status">
          Cargando registro…
        </p>
      )}
      {error && !deleting && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="inline muted" style={{ justifyContent: 'space-between', fontSize: 13 }}>
        <span>
          {total} {total === 1 ? entityLabels[type].toLocaleLowerCase('es') : plural[type]}
          {!entityPage && ownRecords.length !== filtered.length ? ` de ${ownRecords.length}` : ''}
        </span>
        {type === 'activities' && (
          <span>
            {formatMinutes(allMinutes)} {entityPage ? 'en esta página' : 'registrados'}
          </span>
        )}
      </div>
      {visible.length ? (
        <div className="record-grid">
          {visible.map((record) => {
            const summary = summaries[record.id];
            const related = relatedRecords(record, snapshot.records);
            const sessions = related.filter(
              (item) =>
                isActivity(item) && (item.occurredAt ?? item.createdAt) <= snapshot.generatedAt,
            );
            const goal =
              summary?.goal ??
              (record.type === 'goals' ? goalMetric(record, snapshot.records) : undefined);
            const project =
              summary?.project ??
              (record.type === 'projects' ? projectMetric(record, snapshot.records) : undefined);
            const habit =
              summary?.habit ??
              (record.type === 'habits'
                ? habitProgress(
                    record,
                    snapshot.records,
                    snapshot.settings,
                    new Date(snapshot.generatedAt),
                    snapshot.history,
                  )
                : undefined);
            const attention =
              summary?.attention ??
              (record.type === 'interests'
                ? attentionFor(
                    record,
                    snapshot.records,
                    snapshot.settings,
                    new Date(snapshot.generatedAt),
                    snapshot.history,
                  )
                : undefined);
            return (
              <article
                className="card record-card"
                key={record.id}
                style={
                  record.type === 'areas'
                    ? { borderTop: `3px solid ${record.color ?? 'var(--accent)'}` }
                    : undefined
                }
              >
                <div
                  className="inline"
                  style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}
                >
                  <button
                    type="button"
                    className="record-title text-link"
                    style={{ textAlign: 'left', fontWeight: 600, fontSize: 17, lineHeight: 1.4 }}
                    onClick={() => openRecord(record)}
                  >
                    {record.name}
                  </button>
                  <span className={`badge status-${record.status}`}>
                    {statusLabels[record.status]}
                  </span>
                </div>
                {record.description && (
                  <p
                    className="muted"
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      fontSize: 14,
                    }}
                  >
                    {record.description}
                  </p>
                )}
                <div
                  className="record-meta"
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12 }}
                >
                  {record.areaId && (
                    <span className="inline">
                      <Layers3 size={13} />
                      {areas.find((item) => item.id === record.areaId)?.name}
                    </span>
                  )}
                  {record.type === 'activities' && (
                    <>
                      <span>{formatDate(record.occurredAt, timezone, true)}</span>
                      <span className="inline">
                        <Clock3 size={13} />
                        {formatMinutes(record.durationMinutes ?? 0)}
                      </span>
                    </>
                  )}
                  {record.type === 'interests' && (
                    <>
                      <span>Cada {record.frequencyDays} días</span>
                      <span>
                        {(summary?.sessionCount ?? sessions.length)
                          ? formatMinutes(
                              summary?.minutes ??
                                allocatedMinutesForInterest(
                                  record.id,
                                  snapshot.records,
                                  new Date(snapshot.generatedAt),
                                ),
                            )
                          : 'Sin sesiones'}
                      </span>
                    </>
                  )}
                  {record.type === 'areas' && (
                    <>
                      <span>
                        {related.filter((item) => item.type === 'interests').length} intereses
                      </span>
                      <span>
                        {(summary?.sessionCount ?? sessions.length)
                          ? `${summary?.sessionCount ?? sessions.length} sesiones · ${formatMinutes(summary?.minutes ?? allocatedMinutesForArea(record.id, snapshot.records, new Date(snapshot.generatedAt), snapshot.history))}`
                          : 'Sin actividad todavía'}
                      </span>
                    </>
                  )}
                  {goal && (
                    <span>
                      {goal.targetValue !== null
                        ? `${goal.currentValue === null ? 'Sin medición' : goal.currentValue} / ${goal.targetValue} ${goal.unit}`
                        : 'Sin meta numérica'}
                    </span>
                  )}
                  {project && (
                    <span>
                      {project.totalMilestones
                        ? `${project.completedMilestones} / ${project.totalMilestones} hitos`
                        : 'Sin hitos todavía'}
                    </span>
                  )}
                  {record.type === 'seasons' && (
                    <span>
                      {formatDate(record.startDate, timezone)} —{' '}
                      {formatDate(record.endDate, timezone)}
                    </span>
                  )}
                  {record.type === 'reviews' && (
                    <span>Semana del {formatDate(record.weekStart, timezone)}</span>
                  )}
                  {record.type === 'learnings' && (
                    <span className="inline">
                      <BookOpen size={13} />
                      {formatDate(record.occurredAt ?? record.createdAt, timezone)}
                    </span>
                  )}
                </div>
                {attention && <small className="muted">{attention.label}</small>}
                {habit && (
                  <div className="stack" style={{ gap: 6 }}>
                    <div className="inline muted" style={{ fontSize: 13 }}>
                      {habit.paused ? (
                        'En pausa'
                      ) : habit.completed ? (
                        <>
                          <CheckCircle2 size={15} />
                          Período cumplido
                        </>
                      ) : (
                        `${habit.sessions}${habit.targetCount ? ` / ${habit.targetCount}` : ''} sesiones${habit.targetMinutes ? ` · ${Math.round(habit.minutes)} / ${habit.targetMinutes} min` : ''}`
                      )}
                    </div>
                    {habit.progress !== null && !habit.paused && (
                      <progress
                        value={Math.min(habit.progress, 1)}
                        max={1}
                        style={{ width: '100%', accentColor: 'var(--accent)' }}
                        aria-label={`Cumplimiento de ${record.name}`}
                      />
                    )}
                  </div>
                )}
                {record.tags?.length ? (
                  <div className="inline" style={{ flexWrap: 'wrap' }}>
                    {record.tags.slice(0, 4).map((tag) => (
                      <span className="badge" key={tag}>
                        #{tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div
                  className="inline"
                  style={{ justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8 }}
                >
                  <Button variant="ghost" size="sm" onClick={() => openRecord(record)}>
                    Ver detalle
                    <ArrowUpRight size={14} />
                  </Button>
                  <div className="inline">
                    {type === 'areas' && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={reordering}
                          aria-label={`Subir ${record.name}`}
                          onClick={() => void moveArea(record, -1)}
                        >
                          <ArrowUp size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={reordering}
                          aria-label={`Bajar ${record.name}`}
                          onClick={() => void moveArea(record, 1)}
                        >
                          <ArrowDown size={14} />
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${record.name}`}
                      disabled={editLoading}
                      onClick={() => void beginEdit(record)}
                    >
                      <Pencil size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Eliminar ${record.name}`}
                      onClick={() => {
                        setError('');
                        setDeleting(record);
                      }}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state card">
          <div className="empty-icon">
            <Layers3 size={28} />
          </div>
          <h2>
            {hasExisting ? 'No encontramos coincidencias' : `Tu espacio para ${plural[type]}`}
          </h2>
          <p className="muted">
            {hasExisting
              ? 'Prueba otro término de búsqueda o ajusta los filtros.'
              : emptyDescriptions[type]}
          </p>
          {!hasExisting && (
            <Button onClick={() => create()}>
              <Plus size={16} />
              Crear {entityLabels[type].toLowerCase()}
            </Button>
          )}
          {type === 'interests' && !areas.length && (
            <a href="/areas?new=1" className="text-link">
              Primero crea un área de vida
              <ArrowUpRight size={14} />
            </a>
          )}
          {['activities', 'habits'].includes(type) && !interests.length && (
            <a href="/interests?new=1" className="text-link">
              Primero crea un interés
              <ArrowUpRight size={14} />
            </a>
          )}
        </div>
      )}
      {pages > 1 && (
        <nav
          aria-label="Páginas de registros"
          className="inline pagination"
          style={{ justifyContent: 'center' }}
        >
          <Button
            variant="secondary"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() =>
              entityPage
                ? navigateFilters(Math.max(0, entityPage.offset - pageSize))
                : setPage(page - 1)
            }
          >
            <ChevronLeft size={15} />
            Anterior
          </Button>
          <span className="muted">
            {currentPage} / {pages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={currentPage >= pages}
            onClick={() =>
              entityPage ? navigateFilters(entityPage.offset + pageSize) : setPage(page + 1)
            }
          >
            Siguiente
            <ChevronRight size={15} />
          </Button>
        </nav>
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={closeDetail}
        title={selected?.name ?? ''}
        description={selected ? entityLabels[selected.type] : undefined}
      >
        {detailLoading ? (
          <p className="muted" role="status">
            Cargando detalle…
          </p>
        ) : selected && detailData ? (
          <RecordDetail
            key={selected.id}
            record={selected}
            snapshot={detailData.snapshot}
            summary={detailData.summary}
            activityTotal={detailData.activityTotal}
            historyTotal={detailData.historyTotal}
            activityOffset={detailData.activityOffset}
            historyOffset={detailData.historyOffset}
            pageLoading={detailPageLoading}
            onLoadPage={(kind, offset) =>
              void loadDetail(selected.id, selected, {
                activityOffset: kind === 'activities' ? offset : detailData.activityOffset,
                historyOffset: kind === 'history' ? offset : detailData.historyOffset,
              })
            }
            onEdit={(record) => void beginEdit(record)}
            onDelete={(record) => {
              setError('');
              setDeleting(record);
            }}
            onCreate={create}
            onOpen={openRecord}
          />
        ) : (
          <p className="field-error" role="alert">
            {error || 'No se pudo cargar este registro.'}
          </p>
        )}
      </Dialog>
      <Dialog
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open) setEditor(undefined);
        }}
        title={
          editor
            ? `${editor.record ? 'Editar' : 'Crear'} ${entityLabels[editor.type].toLowerCase()}`
            : ''
        }
        description="Los cambios se guardan en tu espacio personal."
      >
        {editor && (
          <RecordForm
            key={`${editor.type}-${editor.record?.id ?? 'new'}`}
            type={editor.type}
            snapshot={snapshot}
            record={editor.record}
            defaults={editor.defaults}
            onSave={save}
            onCancel={() => setEditor(undefined)}
          />
        )}
      </Dialog>
      <ConfirmDelete
        name={deleting?.name ?? ''}
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) {
            setDeleting(undefined);
            setError('');
          }
        }}
        onConfirm={() => void remove()}
        busy={deleteBusy}
        error={error}
      />
    </fieldset>
  );
}
