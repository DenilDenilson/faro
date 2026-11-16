import { StrategyContext } from './StrategyConnections';
import { statusLabels } from './RecordForm';
import { useEffect, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Repeat2,
  Check,
  Play,
  Pencil,
  X,
} from 'lucide-react';
import type { PlanningView } from '../domains/planning';
import type { WeekPlan, PlanSlot } from '../domains/planning/types';
import type { PlanningCommand } from '../domains/planning/validation';
import { addDays, dateKey } from '../domains/analytics/dates';
import {
  apiRequest,
  formatDate,
  formatMinutes,
  localDateTime,
  zonedInputToIso,
} from '../lib/client';
import { Dialog } from './ui/dialog';
import InterestRadar from './InterestRadar';

const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
type PlanDraft = PlanSlot & { id?: string; weekStart: string; day?: string };
function inputFor(plan: WeekPlan): PlanDraft {
  return {
    id: plan.id,
    weekStart: plan.weekStart,
    day: plan.day,
    name: plan.name,
    notes: plan.notes,
    interestIds: plan.interestIds,
    habitIds: plan.habitIds,
    projectIds: plan.projectIds,
    goalIds: plan.goalIds,
    estimatedMinutes: plan.estimatedMinutes,
  };
}
export default function AttentionRadar({ initialView }: { initialView: PlanningView }) {
  const [view, setView] = useState(initialView);
  const [tab, setTab] = useState('week');
  const [area, setArea] = useState('');
  const [weekends, setWeekends] = useState(true);
  const [workQuery, setWorkQuery] = useState('');
  const [expandedWork, setExpandedWork] = useState(false);
  const [saving, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [timerReady, setTimerReady] = useState(false);
  const busy = saving || !ready;
  useEffect(() => {
    setReady(true);
    setTimerReady(Boolean(document.querySelector('.timer-trigger:not(:disabled)')));
    const onReady = () => setTimerReady(true);
    window.addEventListener('faro:timer-ready', onReady);
    return () => window.removeEventListener('faro:timer-ready', onReady);
  }, []);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<PlanDraft>();
  const [selected, setSelected] = useState<WeekPlan>();
  const [logging, setLogging] = useState(false);
  const [logName, setLogName] = useState('');
  const [logDate, setLogDate] = useState('');
  const [logMinutes, setLogMinutes] = useState('');
  const [logNotes, setLogNotes] = useState('');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [closing, setClosing] = useState<'current' | 'previous'>();
  const [carryIds, setCarryIds] = useState<string[]>([]);
  const { snapshot, weekStart, today } = view;
  const timezone = snapshot.settings.timezone;
  const interests = snapshot.records.filter((r) => r.type === 'interests');
  const activeInterests = interests.filter((r) => r.status === 'active');
  const areas = snapshot.records.filter((r) => r.type === 'areas');
  const inArea = (slot: { interestIds?: string[]; areaId?: string }) =>
    !area ||
    slot.areaId === area ||
    slot.interestIds?.some((id) => interests.some((r) => r.id === id && r.areaId === area));
  const plans = view.plans.filter((p) => p.status === 'pending' && inArea(p));
  const activities = view.activities.filter(inArea);
  const rhythms = view.rhythms.filter((r) => inArea(r.habit));
  const attention = view.attention.filter(
    (r) =>
      ['due', 'neglected', 'insufficient'].includes(r.attention.state) &&
      (!area || r.interest.areaId === area),
  );
  const unplaced = plans.filter((p) => !p.day);
  const hasWeekend =
    plans.some((p) => p.day && p.day >= addDays(weekStart, 5)) ||
    activities.some((a) => dateKey(a.occurredAt ?? a.createdAt, timezone) >= addDays(weekStart, 5));
  const sourcePlans =
    closing === 'previous' ? view.previousPlans : view.plans.filter((p) => p.status === 'pending');
  const sourceWeek = closing === 'previous' ? addDays(weekStart, -7) : weekStart;
  const targetWeek = closing === 'previous' ? weekStart : addDays(weekStart, 7);
  async function run(command: PlanningCommand, success: string): Promise<boolean> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await apiRequest('/api/planning', 'POST', command);
      setView(await apiRequest<PlanningView>(`/api/planning?week=${weekStart}`));
      setMessage(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  function create(day?: string, slot?: Partial<PlanSlot>) {
    setError('');
    setDraft({ weekStart, day, name: '', interestIds: [], ...slot });
  }
  async function saveDraft(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    const { id, ...data } = draft;
    if (await run({ action: 'save', id, data }, 'Práctica prevista guardada.')) setDraft(undefined);
  }
  async function move(plan: WeekPlan, day?: string) {
    const { id, ...data } = inputFor(plan);
    if (
      await run(
        { action: 'save', id, data: { ...data, day } },
        day ? 'Práctica movida.' : 'Práctica devuelta a Por ubicar.',
      )
    )
      setSelected(undefined);
  }
  function startLog(plan: WeekPlan) {
    setSelected(plan);
    setLogging(true);
    setLogName(plan.name);
    setLogDate(localDateTime(new Date().toISOString(), timezone));
    setLogMinutes('');
    setLogNotes(plan.notes ?? '');
    setError('');
  }
  function openClosing(mode: 'current' | 'previous') {
    setCarryIds([]);
    setClosing(mode);
    setError('');
  }
  const errorNotice = error && (
    <p className="field-error" role="alert">
      {error}
    </p>
  );
  return (
    <div className="stack weekly-radar" aria-busy={busy}>
      <div className="button-row" role="group" aria-label="Vista del radar">
        <button
          className={`button ${tab === 'week' ? 'button-primary' : ''}`}
          aria-pressed={tab === 'week'}
          onClick={() => setTab('week')}
        >
          <CalendarDays size={16} />
          Mi semana
        </button>
        <button
          className={`button ${tab === 'interests' ? 'button-primary' : ''}`}
          aria-pressed={tab === 'interests'}
          onClick={() => setTab('interests')}
        >
          Estado de intereses
        </button>
      </div>
      {errorNotice}
      <p role="status" aria-live="polite" className="muted small">
        {message}
      </p>
      {tab === 'interests' ? (
        <InterestRadar snapshot={snapshot} initialRows={view.attention} />
      ) : (
        <>
          <div className="week-toolbar">
            <div className="inline week-navigation">
              <a
                className="button icon-button"
                aria-label="Semana anterior"
                href={`/attention?week=${addDays(weekStart, -7)}`}
              >
                <ChevronLeft size={18} />
              </a>
              <div>
                <h2>
                  {formatDate(weekStart, timezone)} — {formatDate(addDays(weekStart, 6), timezone)}
                </h2>
                <span className="muted small">Semanas de lunes a domingo · {timezone}</span>
              </div>
              <a
                className="button icon-button"
                aria-label="Semana siguiente"
                href={`/attention?week=${addDays(weekStart, 7)}`}
              >
                <ChevronRight size={18} />
              </a>
            </div>
            <div className="button-row">
              <a className="button subtle" href="/attention">
                Esta semana
              </a>
              <button
                className="button button-primary"
                disabled={busy || !activeInterests.length}
                onClick={() => create()}
              >
                <Plus size={15} />
                Nueva práctica
              </button>
            </div>
          </div>
          <div className="week-options">
            <label className="field">
              Área
              <select value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">Todas las áreas</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={weekends}
                onChange={(e) => setWeekends(e.target.checked)}
              />
              Mostrar fin de semana
            </label>
            <div className="button-row">
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    { action: 'suggest', weekStart },
                    'Prácticas sugeridas desde tus hábitos; puedes editarlas o descartarlas.',
                  )
                }
              >
                <Repeat2 size={15} />
                Sugerir desde hábitos
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  setError('');
                  setTemplatesOpen(true);
                }}
              >
                Semanas tipo
              </button>
              <button className="button" disabled={busy} onClick={() => openClosing('current')}>
                Cerrar semana
              </button>
            </div>
          </div>
          <section className="week-open-work" aria-label="Objetivos y proyectos pendientes">
            <div className="section-heading">
              <div>
                <h2>Lo que tienes por atender</h2>
                <p className="muted small">
                  Incluye pendientes que todavía no has ubicado en esta semana.
                </p>
              </div>
              <a className="text-link" href="/north">
                Mi norte
              </a>
            </div>
            <label className="field">
              Buscar objetivo o proyecto
              <input
                type="search"
                value={workQuery}
                onChange={(e) => setWorkQuery(e.target.value)}
                placeholder="¿En qué quieres avanzar?"
              />
            </label>
            <div className="week-work-grid">
              {(['goals', 'projects'] as const).map((type) => {
                const entries = view.openWork.filter(
                  (row) =>
                    row.record.type === type &&
                    inArea(row.record) &&
                    row.record.name
                      .toLocaleLowerCase('es')
                      .includes(workQuery.toLocaleLowerCase('es')),
                );
                return (
                  <section
                    key={type}
                    aria-label={type === 'goals' ? 'Objetivos pendientes' : 'Proyectos pendientes'}
                  >
                    <div className="section-heading">
                      <h3>{type === 'goals' ? 'Objetivos' : 'Proyectos'}</h3>
                      <span className="badge">{entries.length}</span>
                    </div>
                    {entries.length ? (
                      entries
                        .slice(0, expandedWork ? entries.length : 4)
                        .map(({ record, progress, nextMilestone }) => (
                          <article className="week-work-row" key={record.id}>
                            <div>
                              <a className="text-link" href={`/${type}?id=${record.id}`}>
                                {record.name}
                              </a>
                              <p className="muted small">
                                {statusLabels[record.status]}
                                {record.priority === 3 ? ' · Prioridad alta' : ''}
                                {record.endDate ? ` · ${formatDate(record.endDate, timezone)}` : ''}
                                {progress !== null ? ` · ${Math.round(progress * 100)} %` : ''}
                              </p>
                              {nextMilestone && (
                                <p className="muted small">Próximo hito: {nextMilestone.name}</p>
                              )}
                            </div>
                            <button
                              className="button"
                              disabled={busy || !activeInterests.length}
                              aria-label={`Planificar acción para ${record.name}`}
                              onClick={() =>
                                create(undefined, {
                                  name: nextMilestone
                                    ? `Trabajar en ${nextMilestone.name}`
                                    : `Avanzar en ${record.name}`,
                                  interestIds: record.interestIds ?? [],
                                  goalIds: type === 'goals' ? [record.id] : record.goalIds,
                                  projectIds: type === 'projects' ? [record.id] : record.projectIds,
                                })
                              }
                            >
                              Planificar
                            </button>
                          </article>
                        ))
                    ) : (
                      <p className="muted small">
                        No hay {type === 'goals' ? 'objetivos' : 'proyectos'} pendientes con esta
                        selección.
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
            {view.openWork.length > 4 && (
              <button className="text-link" onClick={() => setExpandedWork(!expandedWork)}>
                {expandedWork ? 'Mostrar menos' : 'Ver todos los pendientes'}
              </button>
            )}
          </section>
          {!activeInterests.length && (
            <div className="callout">
              Para planificar, crea o reactiva un <a href="/interests">interés</a>. Tus intereses en
              pausa siguen disponibles en «Estado de intereses».
            </div>
          )}
          {!weekends && hasWeekend && (
            <button className="text-link" onClick={() => setWeekends(true)}>
              Hay prácticas o sesiones el fin de semana. Mostrar sábado y domingo.
            </button>
          )}
          <div
            className={`week-calendar ${weekends ? '' : 'workdays'}`}
            aria-label="Calendario semanal"
          >
            {weekdays.slice(0, weekends ? 7 : 5).map((name, index) => {
              const day = addDays(weekStart, index);
              const dailyPlans = plans.filter((p) => p.day === day);
              const done = activities.filter(
                (a) => dateKey(a.occurredAt ?? a.createdAt, timezone) === day,
              );
              const estimated = dailyPlans.reduce((n, p) => n + (p.estimatedMinutes ?? 0), 0);
              const unknown = dailyPlans.filter((p) => !p.estimatedMinutes).length;
              return (
                <section
                  className="week-day"
                  data-today={day === today}
                  key={day}
                  aria-label={name}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const plan = plans.find(
                      (p) =>
                        p.id ===
                        (e.dataTransfer.getData('text/faro-plan') ||
                          e.dataTransfer.getData('text/plain')),
                    );
                    if (plan && !busy) void move(plan, day);
                  }}
                >
                  <div className="week-day-heading">
                    <h3>
                      {name.slice(0, 3)} <span>{Number(day.slice(-2))}</span>
                    </h3>
                    {day === today && <span className="badge">Hoy</span>}
                  </div>
                  <div className="week-day-load small muted">
                    {dailyPlans.length} previstas
                    {estimated > 0 && <> · {formatMinutes(estimated)}</>}
                    {unknown > 0 && <div>{unknown} sin estimar</div>}
                  </div>
                  <div className="week-events">
                    {done.map((activity) => (
                      <a
                        className="week-entry done"
                        key={activity.id}
                        href={`/activities?id=${activity.id}`}
                      >
                        <span className="inline">
                          <Check size={13} />
                          Realizado
                        </span>
                        <strong>{activity.name}</strong>
                        <span>{formatMinutes(activity.durationMinutes ?? 0)}</span>
                      </a>
                    ))}
                    {dailyPlans.map((plan) => (
                      <button
                        className="week-entry planned"
                        type="button"
                        key={plan.id}
                        disabled={busy}
                        draggable={!busy}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/faro-plan', plan.id);
                          e.dataTransfer.setData('text/plain', plan.id);
                        }}
                        onClick={() => {
                          setSelected(plan);
                          setLogging(false);
                          setError('');
                        }}
                      >
                        <span>Previsto</span>
                        <strong>{plan.name}</strong>
                        <span>
                          {plan.estimatedMinutes
                            ? formatMinutes(plan.estimatedMinutes)
                            : 'Sin duración estimada'}
                        </span>
                      </button>
                    ))}
                    {!dailyPlans.length && !done.length && (
                      <span className="muted small">Sin prácticas</span>
                    )}
                  </div>
                  <button
                    className="week-add"
                    aria-label={`Añadir práctica el ${name.toLowerCase()}`}
                    disabled={busy || !activeInterests.length}
                    onClick={() => create(day)}
                  >
                    <Plus size={14} />
                    Añadir
                  </button>
                </section>
              );
            })}
          </div>
          <p className="muted small">
            Arrastra una práctica a otro día o ábrela para cambiar su fecha. Lo previsto cuenta al
            registrar una sesión real.
          </p>
          <div className="week-support">
            <section>
              <div className="section-heading">
                <h2>Ritmos y progreso</h2>
                <a href="/habits" className="text-link">
                  Hábitos
                </a>
              </div>
              {!rhythms.length && (
                <p className="muted">
                  Puedes planificar intereses sin crear hábitos. Añade un hábito cuando quieras una
                  meta recurrente.
                </p>
              )}
              <div className="stack">
                {rhythms.map((r) => (
                  <div className="week-rhythm" key={r.habit.id}>
                    <div className="section-heading">
                      <a href={`/habits?id=${r.habit.id}`}>{r.habit.name}</a>
                      <span className="small">
                        {r.target > 0 ? (
                          <>
                            {r.minutes ? formatMinutes(r.done) : r.done} /{' '}
                            {r.minutes ? formatMinutes(r.target) : r.target}
                          </>
                        ) : (
                          'Sin período aplicable'
                        )}
                      </span>
                    </div>
                    {r.target > 0 && (
                      <div
                        className="week-progress"
                        role="progressbar"
                        aria-label={`${r.habit.name}: realizado`}
                        aria-valuemin={0}
                        aria-valuemax={r.target || 1}
                        aria-valuenow={Math.min(r.done, r.target)}
                      >
                        <span
                          style={{
                            width: `${r.target ? Math.min(100, (r.done / r.target) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    )}
                    <p className="muted small">
                      {r.periodLabel} ·{' '}
                      {r.excused ? 'En pausa o período exento' : `${r.planned} previstas`}
                      {!r.excused && r.remaining > 0 && (
                        <>
                          {' '}
                          · {r.minutes ? formatMinutes(r.remaining) : r.remaining} por planificar
                        </>
                      )}
                    </p>
                    {!r.excused && r.remaining > 0 && (
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() =>
                          create(undefined, {
                            name: r.habit.name,
                            interestIds: r.habit.interestIds ?? [],
                            habitIds: [r.habit.id],
                            projectIds: r.habit.projectIds,
                            goalIds: r.habit.goalIds,
                          })
                        }
                      >
                        Añadir práctica
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
            <section>
              <div className="section-heading">
                <h2>Por ubicar</h2>
                <span className="badge">{unplaced.length}</span>
              </div>
              <div className="stack">
                {unplaced.length ? (
                  unplaced.map((plan) => (
                    <button
                      className="week-unplaced"
                      key={plan.id}
                      disabled={busy}
                      onClick={() => {
                        setSelected(plan);
                        setLogging(false);
                        setError('');
                      }}
                    >
                      <strong>{plan.name}</strong>
                      <span className="muted small">
                        {plan.estimatedMinutes
                          ? formatMinutes(plan.estimatedMinutes)
                          : 'Sin duración estimada'}{' '}
                        · Elegir día
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="muted">No hay prácticas pendientes de elegir día.</p>
                )}
              </div>
              {view.previousPlans.length > 0 && (
                <div className="week-previous">
                  <p>
                    {view.previousPlans.length} prácticas quedaron pendientes la semana anterior.
                  </p>
                  <button className="text-link" onClick={() => openClosing('previous')}>
                    Elegir cuáles retomar
                  </button>
                </div>
              )}
            </section>
          </div>
          <section>
            <div className="section-heading">
              <h2>Para retomar</h2>
              <span className="muted small">Estado actual de tus intereses</span>
            </div>
            <div className="week-attention-list">
              {attention.length ? (
                attention.map(({ interest, attention: a }) => (
                  <div className="week-attention-row" key={interest.id}>
                    <div>
                      <a href={`/interests?id=${interest.id}`}>{interest.name}</a>
                      <p className="muted small">
                        {a.label} ·{' '}
                        {a.daysSinceLast === null
                          ? 'Sin sesiones'
                          : `${a.daysSinceLast} días sin practicar`}{' '}
                        · Cada {a.frequencyDays} días
                      </p>
                    </div>
                    <button
                      className="button"
                      disabled={busy || interest.status !== 'active'}
                      onClick={() =>
                        create(undefined, { name: interest.name, interestIds: [interest.id] })
                      }
                    >
                      Incluir en mi semana
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted">No hay avisos de atención con esta selección.</p>
              )}
            </div>
          </section>
          {view.plans.some((p) => p.status === 'cancelled') && (
            <details>
              <summary>Prácticas descartadas esta semana</summary>
              <ul>
                {view.plans
                  .filter((p) => p.status === 'cancelled')
                  .map((p) => (
                    <li key={p.id}>{p.name}</li>
                  ))}
              </ul>
            </details>
          )}
        </>
      )}

      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (!open && !busy) setDraft(undefined);
        }}
        title={draft?.id ? 'Editar práctica prevista' : 'Nueva práctica prevista'}
        description="Escribe qué quieres hacer. El día y la duración estimada son opcionales."
      >
        {draft && (
          <form className="stack" onSubmit={saveDraft}>
            <label className="field">
              Qué quiero hacer
              <input
                autoFocus
                required
                maxLength={200}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Practicar cambios entre acordes"
              />
            </label>
            <label className="field">
              Interés
              <select
                required
                value={draft.interestIds[0] ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    interestIds: e.target.value ? [e.target.value] : [],
                    habitIds: [],
                  })
                }
              >
                <option value="">Seleccionar interés</option>
                {interests
                  .filter((i) => i.status === 'active' || draft.interestIds.includes(i.id))
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              Hábito (opcional)
              <select
                value={draft.habitIds?.[0] ?? ''}
                onChange={(e) => {
                  const habit = snapshot.records.find((r) => r.id === e.target.value);
                  setDraft({
                    ...draft,
                    habitIds: habit ? [habit.id] : [],
                    interestIds: habit?.interestIds ?? draft.interestIds,
                    projectIds: habit?.projectIds ?? draft.projectIds,
                    goalIds: habit?.goalIds ?? draft.goalIds,
                  });
                }}
              >
                <option value="">Sin hábito</option>
                {snapshot.records
                  .filter(
                    (r) =>
                      r.type === 'habits' &&
                      (r.status === 'active' || draft.habitIds?.includes(r.id)),
                  )
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-grid">
              <label className="field">
                Día
                <select
                  value={draft.day ?? ''}
                  onChange={(e) => setDraft({ ...draft, day: e.target.value || undefined })}
                >
                  <option value="">Por ubicar</option>
                  {weekdays.map((d, i) => (
                    <option value={addDays(weekStart, i)} key={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Minutos estimados (opcional)
                <input
                  type="number"
                  min="1"
                  max="1440"
                  step="any"
                  value={draft.estimatedMinutes ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      estimatedMinutes: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                />
              </label>
            </div>
            <div className="form-grid">
              {(['projects', 'goals'] as const).map((type, i) => {
                const key = i === 0 ? 'projectIds' : 'goalIds';
                return (
                  <label className="field" key={type}>
                    {i === 0 ? 'Proyecto' : 'Objetivo'} (opcional)
                    <select
                      value={draft[key]?.[0] ?? ''}
                      onChange={(e) =>
                        setDraft({ ...draft, [key]: e.target.value ? [e.target.value] : [] })
                      }
                    >
                      <option value="">Sin vincular</option>
                      {snapshot.records
                        .filter((r) => r.type === type)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  </label>
                );
              })}
            </div>
            <label className="field">
              Notas para la práctica
              <textarea
                maxLength={20000}
                value={draft.notes ?? ''}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </label>
            {errorNotice}
            <button className="button button-primary" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar práctica'}
            </button>
          </form>
        )}
      </Dialog>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setSelected(undefined);
            setLogging(false);
          }
        }}
        title={logging ? 'Registrar sesión realizada' : (selected?.name ?? 'Práctica prevista')}
        description={
          logging
            ? 'Confirma lo que hiciste y su duración real.'
            : 'Esta práctica es una intención; todavía no cuenta como sesión realizada.'
        }
      >
        {selected &&
          (logging ? (
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const occurredAt = zonedInputToIso(logDate, timezone);
                  if (
                    await run(
                      {
                        action: 'complete',
                        id: selected.id,
                        name: logName,
                        occurredAt,
                        durationMinutes: Number(logMinutes),
                        notes: logNotes,
                      },
                      'Sesión registrada. Tu progreso ya está actualizado.',
                    )
                  ) {
                    setSelected(undefined);
                    setLogging(false);
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Fecha inválida');
                }
              }}
            >
              <label className="field">
                Actividad realizada
                <input
                  required
                  maxLength={200}
                  value={logName}
                  onChange={(e) => setLogName(e.target.value)}
                />
              </label>
              <label className="field">
                Fecha y hora ({timezone})
                <input
                  required
                  type="datetime-local"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                />
              </label>
              <label className="field">
                Minutos reales
                <input
                  required
                  type="number"
                  min="0.01"
                  step="any"
                  max="1440"
                  value={logMinutes}
                  onChange={(e) => setLogMinutes(e.target.value)}
                />
              </label>
              <label className="field">
                Notas
                <textarea
                  maxLength={20000}
                  value={logNotes}
                  onChange={(e) => setLogNotes(e.target.value)}
                />
              </label>
              <p className="muted small">
                Se conservarán los vínculos con sus intereses, hábitos, proyectos y objetivos.
              </p>
              {errorNotice}
              <button className="button button-primary" disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar sesión'}
              </button>
            </form>
          ) : (
            <div className="stack">
              <p className="muted">
                {selected.day ? formatDate(selected.day, timezone) : 'Por ubicar'} ·{' '}
                {selected.estimatedMinutes
                  ? `${formatMinutes(selected.estimatedMinutes)} estimados`
                  : 'Sin duración estimada'}
              </p>
              {snapshot.records
                .filter((r) =>
                  [
                    ...(selected.goalIds ?? []),
                    ...(selected.projectIds ?? []),
                    ...(selected.habitIds ?? []),
                  ].includes(r.id),
                )
                .map((r) => (
                  <div key={r.id}>
                    <a className="text-link" href={`/${r.type}?id=${r.id}`}>
                      {r.name}
                    </a>
                    <StrategyContext record={r} snapshot={snapshot} />
                  </div>
                ))}
              {selected.notes && <p className="preserve-lines">{selected.notes}</p>}
              <div className="button-row">
                <button
                  className="button button-primary"
                  disabled={busy}
                  onClick={() => startLog(selected)}
                >
                  <Check size={16} />
                  Registrar sesión
                </button>
                <button
                  className="button"
                  disabled={busy || !timerReady}
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('faro:plan-timer', { detail: selected }));
                    setSelected(undefined);
                  }}
                >
                  <Play size={15} />
                  Iniciar cronómetro
                </button>
              </div>
              <label className="field">
                Mover a
                <select
                  disabled={busy}
                  value={selected.day ?? ''}
                  onChange={(e) => void move(selected, e.target.value || undefined)}
                >
                  <option value="">Por ubicar</option>
                  {weekdays.map((d, i) => (
                    <option key={d} value={addDays(weekStart, i)}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <div className="button-row">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    setDraft(inputFor(selected));
                    setSelected(undefined);
                  }}
                >
                  <Pencil size={15} />
                  Editar práctica
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      window.confirm(`¿Descartar «${selected.name}» para esta semana?`) &&
                      (await run(
                        { action: 'cancel', id: selected.id },
                        'Práctica descartada para esta semana.',
                      ))
                    )
                      setSelected(undefined);
                  }}
                >
                  <X size={15} />
                  Descartar esta semana
                </button>
              </div>
              {errorNotice}
            </div>
          ))}
      </Dialog>
      <Dialog
        open={templatesOpen}
        onOpenChange={(open) => {
          if (!busy) setTemplatesOpen(open);
        }}
        title="Semanas tipo"
        description="Reutiliza la distribución de tus prácticas. Las sesiones realizadas no se copian."
      >
        <div className="stack">
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await run(
                  { action: 'template', weekStart, name: templateName },
                  'Semana tipo guardada.',
                )
              )
                setTemplateName('');
            }}
          >
            <label className="field">
              Nombre de la semana tipo
              <input
                required
                maxLength={200}
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Mi semana habitual"
              />
            </label>
            <button
              className="button"
              disabled={busy || !view.plans.some((p) => p.status !== 'cancelled')}
            >
              Guardar distribución de esta semana
            </button>
          </form>
          <hr />
          {view.templates.length ? (
            view.templates.map((t) => (
              <div key={t.id} className="week-template">
                <div>
                  <strong>{t.name}</strong>
                  <p className="muted small">
                    {t.slotCount} prácticas · se aplicará a la semana visible
                  </p>
                </div>
                <div className="button-row">
                  <button
                    className="button button-primary"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await run(
                          { action: 'apply', templateId: t.id, weekStart },
                          'Semana tipo aplicada. Revisa y ajusta tus prácticas.',
                        )
                      )
                        setTemplatesOpen(false);
                    }}
                  >
                    Aplicar
                  </button>
                  <button
                    className="button subtle"
                    aria-label={`Eliminar semana tipo ${t.name}`}
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `¿Eliminar la semana tipo «${t.name}»? Tus planes se conservarán.`,
                        )
                      )
                        void run({ action: 'deleteTemplate', id: t.id }, 'Semana tipo eliminada.');
                    }}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="muted">Todavía no has guardado semanas tipo.</p>
          )}
          {errorNotice}
        </div>
      </Dialog>
      <Dialog
        open={Boolean(closing)}
        onOpenChange={(open) => {
          if (!open && !busy) setClosing(undefined);
        }}
        title={
          closing === 'previous'
            ? 'Retomar pendientes anteriores'
            : 'Cerrar semana y preparar la siguiente'
        }
        description="Elige qué conservar. No se trasladan pendientes automáticamente."
      >
        <div className="stack">
          {closing === 'current' && (
            <p>
              {view.activities.length} sesiones realizadas ·{' '}
              {formatMinutes(view.activities.reduce((n, a) => n + (a.durationMinutes ?? 0), 0))} ·{' '}
              {sourcePlans.length} prácticas pendientes.
            </p>
          )}
          <a
            className="button"
            href={
              (closing === 'current' ? view.reviewId : view.previousReviewId)
                ? `/reviews?id=${closing === 'current' ? view.reviewId : view.previousReviewId}`
                : `/reviews?week=${sourceWeek}`
            }
          >
            Abrir revisión de esta semana
          </a>
          {sourcePlans.length > 0 ? (
            <>
              <p>
                Selecciona las prácticas que quieres retomar en la semana del{' '}
                {formatDate(targetWeek, timezone)}.
              </p>
              {sourcePlans.map((p) => (
                <label className="checkbox-field" key={p.id}>
                  <input
                    type="checkbox"
                    checked={carryIds.includes(p.id)}
                    onChange={(e) =>
                      setCarryIds(
                        e.target.checked
                          ? [...carryIds, p.id]
                          : carryIds.filter((id) => id !== p.id),
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
              <button
                className="button button-primary"
                disabled={busy || !carryIds.length}
                onClick={async () => {
                  if (
                    await run(
                      { action: 'copy', ids: carryIds, weekStart: targetWeek },
                      'Prácticas elegidas trasladadas como nuevos planes.',
                    )
                  )
                    window.location.assign(`/attention?week=${targetWeek}`);
                }}
              >
                Preparar semana con las seleccionadas
              </button>
            </>
          ) : (
            <p className="muted">
              No hay prácticas pendientes. Puedes preparar la próxima semana con una semana tipo.
            </p>
          )}
          <a className="text-link" href={`/attention?week=${targetWeek}`}>
            Ir a la semana del {formatDate(targetWeek, timezone)}
          </a>
          {errorNotice}
        </div>
      </Dialog>
    </div>
  );
}
