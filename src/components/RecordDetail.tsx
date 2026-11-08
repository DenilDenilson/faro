import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { EntityType, FaroRecord, FaroSnapshot, RecordInput } from '../lib/types';
import type { EntitySummary } from '../domains/data/views';
import { apiRequest, formatDate, formatMinutes, localDateTime } from '../lib/client';
import { Button } from './ui/button';
import { habitProgress, type HabitPeriod } from '../domains/habits';
import { weeklySummary } from '../domains/reviews';
import { isActivity } from '../domains/analytics/dates';
import {
  allocatedMinutesForArea,
  allocatedMinutesForInterest,
  goalMetric,
} from '../domains/analytics';
import { entityLabels, statusLabels } from './RecordForm';

function pointsTo(source: FaroRecord, target: FaroRecord, records: FaroRecord[]): boolean {
  if (source.id === target.id) return false;
  if (
    source.parentId === target.id ||
    source.activityId === target.id ||
    source.areaId === target.id
  )
    return true;
  if (
    [
      source.interestIds,
      source.habitIds,
      source.projectIds,
      source.goalIds,
      source.learningIds,
      source.focusIds,
      source.maintenanceIds,
      source.explorationIds,
    ].some((ids) => ids?.includes(target.id))
  )
    return true;
  if (
    target.type === 'areas' &&
    source.interestIds?.some((id) => records.find((item) => item.id === id)?.areaId === target.id)
  )
    return true;
  return false;
}
export function relatedRecords(record: FaroRecord, records: FaroRecord[]): FaroRecord[] {
  return records.filter(
    (candidate) => pointsTo(candidate, record, records) || pointsTo(record, candidate, records),
  );
}

export default function RecordDetail({
  record,
  snapshot,
  onEdit,
  onDelete,
  onCreate,
  onOpen,
  summary,
  activityTotal,
  historyTotal,
  activityOffset = 0,
  historyOffset = 0,
  pageLoading = false,
  onLoadPage,
}: {
  record: FaroRecord;
  snapshot: FaroSnapshot;
  onEdit: (record: FaroRecord) => void;
  onDelete: (record: FaroRecord) => void;
  onCreate: (type: EntityType, defaults: Partial<RecordInput>) => void;
  onOpen: (record: FaroRecord) => void;
  summary?: EntitySummary;
  activityTotal?: number;
  historyTotal?: number;
  activityOffset?: number;
  historyOffset?: number;
  pageLoading?: boolean;
  onLoadPage?: (kind: 'activities' | 'history', offset: number) => void;
}) {
  const [tab, setTab] = useState<'summary' | 'sessions' | 'history'>('summary');
  const [historyMonth, setHistoryMonth] = useState('');
  const [monthData, setMonthData] = useState<{
    calendar: { date: string; sessions: number; minutes: number }[];
    periods: HabitPeriod[];
  }>();
  const [monthLoading, setMonthLoading] = useState(false);
  const [monthError, setMonthError] = useState('');
  useEffect(() => {
    if (record.type !== 'habits' || !historyMonth) {
      setMonthData(undefined);
      setMonthLoading(false);
      setMonthError('');
      return;
    }
    let cancelled = false;
    const first = `${historyMonth}-01`;
    const end = new Date(`${first}T12:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    const last = end.toISOString().slice(0, 10);
    setMonthLoading(true);
    setMonthError('');
    setMonthData(undefined);
    apiRequest<{
      calendar: { date: string; sessions: number; minutes: number }[];
      periods: HabitPeriod[];
    }>(`/api/habits/${encodeURIComponent(record.id)}/history?from=${first}&to=${last}`)
      .then((result) => {
        if (!cancelled) setMonthData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setMonthError(cause instanceof Error ? cause.message : 'No se pudo consultar ese mes.');
      })
      .finally(() => {
        if (!cancelled) setMonthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [record.id, record.type, historyMonth]);
  const linked = useMemo(
    () => relatedRecords(record, snapshot.records),
    [record, snapshot.records],
  );
  const sessions = linked
    .filter(
      (item) => isActivity(item) && (item.occurredAt ?? item.createdAt) <= snapshot.generatedAt,
    )
    .sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''));
  const milestones = snapshot.records.filter(
    (item) =>
      item.type === 'milestones' &&
      item.parentId === record.id &&
      !['cancelled', 'archived'].includes(item.status),
  );
  const progress = snapshot.records
    .filter((item) => item.type === 'progress' && item.parentId === record.id)
    .sort((a, b) => (b.occurredAt ?? b.createdAt).localeCompare(a.occurredAt ?? a.createdAt));
  const history = snapshot.history
    .filter((item) => item.recordId === record.id)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const minutes =
    summary?.minutes ??
    (record.type === 'interests'
      ? allocatedMinutesForInterest(record.id, snapshot.records, new Date(snapshot.generatedAt))
      : record.type === 'areas'
        ? allocatedMinutesForArea(
            record.id,
            snapshot.records,
            new Date(snapshot.generatedAt),
            snapshot.history,
          )
        : sessions.reduce((sum, session) => sum + (session.durationMinutes ?? 0), 0));
  const goal =
    summary?.goal ?? (record.type === 'goals' ? goalMetric(record, snapshot.records) : undefined);
  const sessionTotal = activityTotal ?? summary?.sessionCount ?? sessions.length;
  const changeTotal = historyTotal ?? history.length;
  const timezone = snapshot.settings.timezone;
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
  const week =
    summary?.week ??
    (record.type === 'reviews'
      ? weeklySummary(
          snapshot.records,
          snapshot.settings,
          record.weekStart,
          new Date(snapshot.generatedAt),
          snapshot.history,
        )
      : undefined);
  const byId = (id?: string) => snapshot.records.find((item) => item.id === id);
  const date = (value?: string, includeTime = false) => formatDate(value, timezone, includeTime);
  const createActivity = () =>
    onCreate('activities', {
      interestIds: record.type === 'interests' ? [record.id] : record.interestIds,
      ...(record.type === 'habits' ? { habitIds: [record.id], name: record.name } : {}),
      ...(record.type === 'projects' ? { projectIds: [record.id] } : {}),
      ...(record.type === 'goals' ? { goalIds: [record.id] } : {}),
    });
  const groups: Array<{ label: string; ids: string[] | undefined }> = [
    { label: 'Intereses', ids: record.interestIds },
    { label: 'Hábitos', ids: record.habitIds },
    { label: 'Proyectos', ids: record.projectIds },
    { label: 'Objetivos', ids: record.goalIds },
    { label: 'Aprendizajes', ids: record.learningIds },
    { label: 'Focos principales', ids: record.focusIds },
    { label: 'Mantenimiento', ids: record.maintenanceIds },
    { label: 'Exploración', ids: record.explorationIds },
  ];
  const periodLabel =
    record.cadence === 'daily'
      ? 'al día'
      : record.cadence === 'weekly'
        ? 'por semana'
        : record.cadence === 'monthly'
          ? 'por mes'
          : record.cadence === 'interval'
            ? `cada ${record.intervalDays ?? 1} días`
            : 'en los días seleccionados';
  const calendar = useMemo(() => {
    if (historyMonth && !monthData) return [];
    if (monthData?.calendar)
      return monthData.calendar.map((item) => ({ key: item.date, count: item.sessions }));
    if (summary?.calendar)
      return summary.calendar.map((item) => ({ key: item.date, count: item.sessions }));
    const today = localDateTime(new Date().toISOString(), timezone).slice(0, 10);
    const end = new Date(`${today}T12:00:00Z`);
    const counts = new Map<string, number>();
    sessions.forEach((session) => {
      const key = localDateTime(session.occurredAt ?? session.createdAt, timezone).slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from({ length: 56 }, (_, index) => {
      const day = new Date(end);
      day.setUTCDate(day.getUTCDate() - (55 - index));
      const key = day.toISOString().slice(0, 10);
      return { key, count: counts.get(key) ?? 0 };
    });
  }, [sessions, timezone, summary?.calendar, monthData?.calendar, historyMonth]);
  const habitHistory = historyMonth ? (monthData?.periods ?? []) : (habit?.history ?? []);

  return (
    <div className="stack">
      <div
        className="inline"
        style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}
      >
        <span className={`badge status-${record.status}`}>{statusLabels[record.status]}</span>
        <div className="inline">
          <Button variant="secondary" size="sm" onClick={() => onEdit(record)}>
            <Pencil size={14} />
            Editar
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Eliminar ${record.name}`}
            onClick={() => onDelete(record)}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      </div>
      <div
        className="inline"
        role="tablist"
        aria-label="Detalle del registro"
        style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}
      >
        {(['summary', 'sessions', 'history'] as const).map((value) => (
          <Button
            key={value}
            variant={tab === value ? 'default' : 'ghost'}
            size="sm"
            role="tab"
            id={`tab-${value}`}
            aria-controls={`detail-${value}`}
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {value === 'summary'
              ? 'Resumen'
              : value === 'sessions'
                ? `Sesiones (${sessionTotal})`
                : 'Historial'}
          </Button>
        ))}
      </div>
      {pageLoading && (
        <p className="muted" role="status">
          Cargando página…
        </p>
      )}
      <div role="tabpanel" id={`detail-${tab}`} aria-labelledby={`tab-${tab}`} className="stack">
        {tab === 'summary' && (
          <>
            {record.description && <p style={{ whiteSpace: 'pre-wrap' }}>{record.description}</p>}
            <div className="detail-grid">
              {record.areaId && (
                <div>
                  <small className="muted">Área de vida</small>
                  <p>{byId(record.areaId)?.name ?? 'Área no disponible'}</p>
                </div>
              )}
              {record.priority !== undefined && (
                <div>
                  <small className="muted">Prioridad</small>
                  <p>{record.priority === 3 ? 'Alta' : record.priority === 2 ? 'Media' : 'Baja'}</p>
                </div>
              )}
              {record.frequencyDays && (
                <div>
                  <small className="muted">Frecuencia deseada</small>
                  <p>
                    Cada {record.frequencyDays} {record.frequencyDays === 1 ? 'día' : 'días'}
                  </p>
                </div>
              )}
              {record.type === 'activities' && (
                <>
                  <div>
                    <small className="muted">Fecha de la sesión</small>
                    <p>{date(record.occurredAt, true)}</p>
                  </div>
                  <div>
                    <small className="muted">Duración</small>
                    <p>{formatMinutes(record.durationMinutes ?? 0)}</p>
                  </div>
                </>
              )}
              {['areas', 'interests', 'goals', 'habits', 'projects'].includes(record.type) && (
                <>
                  <div>
                    <small className="muted">Sesiones vinculadas</small>
                    <p>
                      {sessionTotal
                        ? `${sessionTotal} · ${formatMinutes(minutes)}`
                        : 'Sin sesiones todavía'}
                    </p>
                  </div>
                  <div>
                    <small className="muted">Última actividad</small>
                    <p>
                      {summary?.lastActivityAt
                        ? date(summary.lastActivityAt, true)
                        : sessions.length
                          ? date(sessions[0].occurredAt, true)
                          : 'Todavía no hay actividad'}
                    </p>
                  </div>
                </>
              )}
              {record.startDate && (
                <div>
                  <small className="muted">Inicio</small>
                  <p>{date(record.startDate)}</p>
                </div>
              )}
              {record.endDate && (
                <div>
                  <small className="muted">Fecha objetivo</small>
                  <p>{date(record.endDate)}</p>
                </div>
              )}
              {record.type === 'habits' && (
                <div>
                  <small className="muted">Compromiso</small>
                  <p>
                    {record.targetCount ? `${record.targetCount} sesiones ` : ''}
                    {record.targetCount && record.targetMinutes ? ' y ' : ''}
                    {record.targetMinutes ? `${record.targetMinutes} minutos ` : ''}
                    {periodLabel}
                  </p>
                  {record.cadence === 'custom' && (
                    <small className="muted">
                      {record.weekdays
                        ?.map((day) => ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][day])
                        .join(', ')}
                    </small>
                  )}
                  {record.status === 'paused' && (
                    <p className="muted">
                      En pausa: no genera pendientes ni penaliza el cumplimiento.
                    </p>
                  )}
                </div>
              )}
              {record.type === 'learnings' && (
                <div>
                  <small className="muted">Descubierto el</small>
                  <p>{date(record.occurredAt ?? record.createdAt)}</p>
                </div>
              )}
              {record.type === 'progress' && (
                <div>
                  <small className="muted">Valor registrado</small>
                  <p>
                    {record.value} {byId(record.parentId)?.unit}
                  </p>
                </div>
              )}
              {record.parentId && (
                <div>
                  <small className="muted">Relacionado con</small>
                  <p>
                    <button
                      className="text-link"
                      type="button"
                      onClick={() => {
                        const parent = byId(record.parentId);
                        if (parent) onOpen(parent);
                      }}
                    >
                      {byId(record.parentId)?.name}
                    </button>
                  </p>
                </div>
              )}
            </div>
            {goal && (
              <section className="stack">
                <h3>Resultado y avance</h3>
                {record.outcomes && <p style={{ whiteSpace: 'pre-wrap' }}>{record.outcomes}</p>}
                {goal.targetValue !== null ? (
                  <>
                    <strong>
                      {goal.currentValue === null ? 'Sin medición' : goal.currentValue} /{' '}
                      {goal.targetValue} {goal.unit}
                    </strong>
                    {goal.progress !== null && (
                      <progress
                        max={1}
                        value={goal.progress}
                        style={{ width: '100%', accentColor: 'var(--accent)' }}
                        aria-label="Avance medido del objetivo"
                      />
                    )}
                    <small className="muted">
                      Avance medido con valores registrados, independiente de las horas dedicadas.
                    </small>
                  </>
                ) : (
                  <p className="muted">
                    Este objetivo no tiene una meta numérica; evalúa sus criterios de éxito.
                  </p>
                )}
              </section>
            )}
            {['areas', 'interests'].includes(record.type) && sessionTotal > 0 && (
              <small className="muted">
                El tiempo se distribuye entre los intereses de cada sesión, conservando la duración
                total.
              </small>
            )}
            {['goals', 'projects'].includes(record.type) && (
              <section className="stack">
                <div className="section-heading">
                  <h3>Avances registrados</h3>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      onCreate('progress', {
                        parentId: record.id,
                        name: `Avance de ${record.name}`,
                        value: record.currentValue ?? 0,
                      })
                    }
                  >
                    <Plus size={14} />
                    Registrar avance
                  </Button>
                </div>
                {progress.length ? (
                  <ul className="detail-list">
                    {progress.map((entry) => (
                      <li key={entry.id}>
                        <button className="text-link" type="button" onClick={() => onOpen(entry)}>
                          {entry.name}
                        </button>
                        <span>
                          {entry.value} {record.unit} · {date(entry.occurredAt ?? entry.createdAt)}
                        </span>
                        {entry.notes && <small className="muted">{entry.notes}</small>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Todavía no has registrado avances medidos.</p>
                )}
              </section>
            )}
            {record.type === 'projects' && (
              <section className="stack">
                <div className="section-heading">
                  <h3>Hitos</h3>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onCreate('milestones', { parentId: record.id })}
                  >
                    <Plus size={14} />
                    Añadir hito
                  </Button>
                </div>
                {milestones.length ? (
                  <>
                    <p className="muted">
                      {milestones.filter((item) => item.status === 'completed').length} de{' '}
                      {milestones.length} hitos completados
                    </p>
                    <ul className="detail-list">
                      {milestones.map((milestone) => (
                        <li key={milestone.id}>
                          <div className="inline">
                            {milestone.status === 'completed' ? (
                              <Check size={17} />
                            ) : (
                              <span style={{ width: 17 }}>○</span>
                            )}
                            <button
                              className="text-link"
                              type="button"
                              onClick={() => onOpen(milestone)}
                            >
                              {milestone.name}
                            </button>
                            <Button size="sm" variant="ghost" onClick={() => onEdit(milestone)}>
                              <Pencil size={13} />
                              Editar
                            </Button>
                          </div>
                          <small className="muted">
                            {statusLabels[milestone.status]}
                            {milestone.endDate ? ` · ${date(milestone.endDate)}` : ''}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="muted">Divide este proyecto en entregables concretos.</p>
                )}
              </section>
            )}
            {habit && (
              <section className="stack">
                <h3>Cumplimiento por período</h3>
                <label className="field">
                  Consultar un mes
                  <input
                    className="input"
                    type="month"
                    value={historyMonth}
                    aria-label="Mes del historial del hábito"
                    onChange={(event) => setHistoryMonth(event.target.value)}
                  />
                </label>
                {historyMonth && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setHistoryMonth('');
                      setMonthData(undefined);
                    }}
                  >
                    Volver a períodos recientes
                  </Button>
                )}
                {monthLoading && (
                  <p className="muted" role="status">
                    Consultando el historial…
                  </p>
                )}
                {monthError && (
                  <p className="field-error" role="alert">
                    {monthError}
                  </p>
                )}
                <p className="muted">
                  {habit.paused
                    ? 'En pausa'
                    : habit.completed
                      ? 'Período actual cumplido'
                      : `${habit.sessions} sesiones · ${formatMinutes(habit.minutes)} en el período actual`}
                  {snapshot.settings.showStreaks && habit.streak !== null
                    ? ` · Racha: ${habit.streak} períodos`
                    : ''}
                </p>
                {habitHistory.length ? (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Período</th>
                          <th>Actividad</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {habitHistory.map((period) => (
                          <tr key={period.periodStart}>
                            <td>
                              {date(period.periodStart)} — {date(period.periodEnd)}
                            </td>
                            <td>
                              {period.sessions} sesiones · {formatMinutes(period.minutes)}
                            </td>
                            <td>
                              {period.completed
                                ? 'Cumplido'
                                : period.excused
                                  ? 'Sin penalización'
                                  : period.open
                                    ? 'En curso'
                                    : 'No cumplido'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">Aún no hay períodos anteriores.</p>
                )}
              </section>
            )}
            {record.type === 'habits' && (
              <section className="stack">
                <div className="inline">
                  <CalendarDays size={18} />
                  <h3>Calendario de práctica</h3>
                </div>
                <p className="muted">
                  {historyMonth ? 'Mes seleccionado.' : 'Últimos 56 días.'} Cada cuadro representa
                  sesiones registradas en tu zona horaria.
                </p>
                <div
                  className="calendar-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(14, minmax(0, 1fr))',
                    gap: 5,
                  }}
                >
                  {calendar.map((day) => (
                    <span
                      className="calendar-day"
                      key={day.key}
                      title={`${date(day.key)}: ${day.count} sesiones`}
                      aria-label={`${date(day.key)}: ${day.count} sesiones`}
                      style={{
                        aspectRatio: '1',
                        background: day.count ? 'var(--accent, #227666)' : 'var(--border, #e0e4df)',
                        borderRadius: 4,
                        opacity: day.count ? Math.min(0.55 + day.count * 0.15, 1) : 0.5,
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
            {week && (
              <section className="stack">
                <h3>Resumen de la semana</h3>
                <div className="detail-grid">
                  <div>
                    <small className="muted">Tiempo dedicado</small>
                    <p>{formatMinutes(week.totalMinutes)}</p>
                  </div>
                  <div>
                    <small className="muted">Actividades</small>
                    <p>{week.activityCount}</p>
                  </div>
                  <div>
                    <small className="muted">Cambio de tiempo</small>
                    <p>
                      {week.minutesChange >= 0 ? '+' : '−'}
                      {formatMinutes(Math.abs(week.minutesChange))} frente a la semana anterior
                    </p>
                  </div>
                </div>
                {[
                  { label: 'Hábitos cumplidos', items: week.completedHabits },
                  { label: 'Proyectos con avances', items: week.projectsWithProgress },
                  { label: 'Objetivos atendidos', items: week.goalsAttended },
                  { label: 'Áreas sin actividad', items: week.unattendedAreas },
                ].map((group) => (
                  <div key={group.label}>
                    <strong>{group.label}</strong>
                    <p className="muted">
                      {group.items.map((item) => item.name).join(', ') ||
                        'Sin registros en este período'}
                    </p>
                  </div>
                ))}
              </section>
            )}
            {record.type === 'reviews' && (
              <section className="stack">
                <p className="muted">Semana que comienza el {date(record.weekStart)}</p>
                {(
                  [
                    ['reflections', 'Reflexiones'],
                    ['achievements', 'Logros'],
                    ['difficulties', 'Dificultades'],
                    ['decisions', 'Decisiones'],
                    ['nextPriorities', 'Próximas prioridades'],
                  ] as const
                ).map(([key, label]) =>
                  record[key] ? (
                    <div key={key}>
                      <h3>{label}</h3>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{record[key]}</p>
                    </div>
                  ) : null,
                )}
              </section>
            )}
            {groups
              .filter((group) => group.ids?.length)
              .map((group) => (
                <section key={group.label}>
                  <h3>{group.label}</h3>
                  <div className="inline" style={{ flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {group.ids?.map((id) => {
                      const item = byId(id);
                      return (
                        item && (
                          <Button
                            variant="secondary"
                            size="sm"
                            key={id}
                            onClick={() => onOpen(item)}
                          >
                            {item.name}
                            <ArrowUpRight size={13} />
                          </Button>
                        )
                      );
                    })}
                  </div>
                </section>
              ))}
            {record.tags?.length ? (
              <div className="inline" style={{ flexWrap: 'wrap' }}>
                {record.tags.map((tag) => (
                  <span className="badge" key={tag}>
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
            {record.references?.length ? (
              <section>
                <h3>Enlaces y referencias</h3>
                <ul className="detail-list">
                  {record.references.map((reference) => (
                    <li key={reference}>
                      <a
                        href={/^https?:\/\//.test(reference) ? reference : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-link"
                      >
                        {reference}
                        <ExternalLink size={13} />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {record.activityId && byId(record.activityId) && (
              <Button variant="secondary" onClick={() => onOpen(byId(record.activityId)!)}>
                Ver sesión de estudio vinculada
                <ArrowUpRight size={14} />
              </Button>
            )}
            {record.notes && (
              <section>
                <h3>Notas</h3>
                <p style={{ whiteSpace: 'pre-wrap' }}>{record.notes}</p>
              </section>
            )}
            {linked.some(
              (item) => !['activities', 'progress', 'milestones'].includes(item.type),
            ) && (
              <section>
                <h3>En tu vida</h3>
                <ul className="detail-list">
                  {linked
                    .filter((item) => !['activities', 'progress', 'milestones'].includes(item.type))
                    .map((item) => (
                      <li key={item.id}>
                        <button className="text-link" type="button" onClick={() => onOpen(item)}>
                          {item.name}
                          <ArrowUpRight size={13} />
                        </button>
                        <small className="muted">
                          {entityLabels[item.type]} · {statusLabels[item.status]}
                        </small>
                      </li>
                    ))}
                </ul>
              </section>
            )}
            {['interests', 'habits', 'goals', 'projects'].includes(record.type) && (
              <Button onClick={createActivity}>
                <Plus size={16} />
                Registrar sesión
              </Button>
            )}
            <small className="muted">
              Creado el {date(record.createdAt)} · Actualizado el {date(record.updatedAt)}
            </small>
          </>
        )}
        {tab === 'sessions' && (
          <>
            {sessions.length ? (
              <ul className="detail-list">
                {sessions.map((session) => (
                  <li key={session.id}>
                    <button type="button" className="text-link" onClick={() => onOpen(session)}>
                      {session.name}
                      <ArrowUpRight size={13} />
                    </button>
                    <div className="record-meta">
                      <span>{date(session.occurredAt, true)}</span>
                      <span className="inline">
                        <Clock3 size={13} />
                        {formatMinutes(session.durationMinutes ?? 0)}
                      </span>
                    </div>
                    {session.notes && <small className="muted">{session.notes}</small>}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-state">
                <p>Aún no hay sesiones vinculadas.</p>
                <Button onClick={createActivity}>Registrar la primera sesión</Button>
              </div>
            )}
            {onLoadPage && sessionTotal > 50 && (
              <nav className="inline pagination" aria-label="Páginas de sesiones">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pageLoading || activityOffset === 0}
                  onClick={() => onLoadPage('activities', Math.max(0, activityOffset - 50))}
                >
                  <ChevronLeft size={14} />
                  Anteriores
                </Button>
                <span className="muted">
                  {activityOffset + 1}–{Math.min(activityOffset + 50, sessionTotal)} de{' '}
                  {sessionTotal}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pageLoading || activityOffset + 50 >= sessionTotal}
                  onClick={() => onLoadPage('activities', activityOffset + 50)}
                >
                  Siguientes
                  <ChevronRight size={14} />
                </Button>
              </nav>
            )}
            <small className="muted">
              Las sesiones se muestran una sola vez, aunque compartan varias relaciones.
            </small>
          </>
        )}
        {tab === 'history' && (
          <>
            {history.length ? (
              <ul className="detail-list">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <strong>
                      {entry.operation === 'create'
                        ? 'Registro creado'
                        : entry.operation === 'delete'
                          ? 'Registro eliminado'
                          : 'Registro actualizado'}
                    </strong>
                    <small className="muted">{date(entry.occurredAt, true)}</small>
                    {entry.before && entry.after && (
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                        {(
                          [
                            'status',
                            'frequencyDays',
                            'priority',
                            'cadence',
                            'targetCount',
                            'targetMinutes',
                          ] as const
                        )
                          .filter((key) => entry.before?.[key] !== entry.after?.[key])
                          .map((key) => (
                            <li key={key}>
                              {key === 'status'
                                ? 'Estado'
                                : key === 'frequencyDays'
                                  ? 'Frecuencia en días'
                                  : key === 'priority'
                                    ? 'Prioridad'
                                    : key === 'cadence'
                                      ? 'Frecuencia del hábito'
                                      : key === 'targetCount'
                                        ? 'Sesiones objetivo'
                                        : 'Minutos objetivo'}
                              : {String(entry.before?.[key] ?? 'sin definir')} →{' '}
                              {String(entry.after?.[key] ?? 'sin definir')}
                            </li>
                          ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No hay cambios anteriores registrados.</p>
            )}
            {onLoadPage && changeTotal > 50 && (
              <nav className="inline pagination" aria-label="Páginas de cambios">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pageLoading || historyOffset === 0}
                  onClick={() => onLoadPage('history', Math.max(0, historyOffset - 50))}
                >
                  <ChevronLeft size={14} />
                  Anteriores
                </Button>
                <span className="muted">
                  {historyOffset + 1}–{Math.min(historyOffset + 50, changeTotal)} de {changeTotal}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pageLoading || historyOffset + 50 >= changeTotal}
                  onClick={() => onLoadPage('history', historyOffset + 50)}
                >
                  Siguientes
                  <ChevronRight size={14} />
                </Button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
