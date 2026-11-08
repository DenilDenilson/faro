import {
  Activity,
  ArrowUpRight,
  Clock3,
  Compass,
  FolderKanban,
  Layers3,
  Leaf,
  Plus,
  Repeat2,
  Sprout,
  Target,
} from 'lucide-react';
import type { FaroSnapshot } from '../lib/types';
import { attentionFor } from '../domains/attention';
import { habitProgress } from '../domains/habits';
import { buildAnalytics, goalMetric, projectMetric } from '../domains/analytics';
import { dateKey, isActivity, startOfWeek } from '../domains/analytics/dates';
import { formatMinutes as duration } from '../lib/client';
export default function Overview({ snapshot }: { snapshot: FaroSnapshot }) {
  const { records, settings, history } = snapshot;
  const now = new Date(snapshot.generatedAt);
  const today = dateKey(now, settings.timezone);
  const weekStart = startOfWeek(today);
  const daily = buildAnalytics(
    records,
    settings,
    { startDate: today, endDate: today },
    now,
    history,
  );
  const weekly = buildAnalytics(
    records,
    settings,
    { startDate: weekStart, endDate: today },
    now,
    history,
  );
  const activities = records
    .filter(
      (record) =>
        isActivity(record) &&
        record.occurredAt &&
        record.occurredAt <= snapshot.generatedAt &&
        dateKey(record.occurredAt, settings.timezone) === today,
    )
    .sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''));
  const neglected = records
    .filter((record) => record.type === 'interests' && record.status === 'active')
    .map((interest) => ({
      interest,
      attention: attentionFor(interest, records, settings, now, history),
    }))
    .filter((row) => row.attention.state === 'neglected' || row.attention.state === 'due')
    .sort((a, b) => (b.attention.daysSinceLast ?? 0) - (a.attention.daysSinceLast ?? 0))
    .slice(0, 3);
  const pendingHabits = records
    .filter((record) => record.type === 'habits' && record.status === 'active')
    .map((habit) => ({ habit, progress: habitProgress(habit, records, settings, now, history) }))
    .filter((row) => !row.progress.completed && row.progress.scheduled && !row.progress.paused)
    .slice(0, 4);
  const projects = records
    .filter(
      (record) =>
        record.type === 'projects' &&
        (record.status === 'in_progress' || record.status === 'active'),
    )
    .sort((a, b) => (b.priority ?? 2) - (a.priority ?? 2))
    .slice(0, 3);
  const goals = records
    .filter((record) => record.type === 'goals' && record.status === 'active')
    .sort((a, b) => (b.priority ?? 2) - (a.priority ?? 2))
    .slice(0, 3);
  const hasAreas = records.some((record) => record.type === 'areas');
  const hasInterests = records.some((record) => record.type === 'interests');
  return (
    <>
      <section className="welcome-panel">
        <div>
          <h2>
            {hasInterests
              ? 'Un día para cultivar lo que importa.'
              : 'Tu vida tiene muchas dimensiones.'}
          </h2>
          <p>
            {hasInterests
              ? 'Cada sesión cuenta. Registra lo que haces y deja que FARO te ayude a mantener la perspectiva.'
              : 'Empieza por tus áreas e intereses. Después, registra lo que haces: tu historia se construye a tu ritmo.'}
          </p>
        </div>
        {hasInterests ? (
          <div className="welcome-illustration">
            <Leaf size={31} strokeWidth={1.4} />
          </div>
        ) : (
          <a
            className="button button-primary"
            href={hasAreas ? '/interests?new=1' : '/areas?new=1'}
          >
            <Plus size={15} />
            {hasAreas ? 'Añadir un interés' : 'Organizar mi vida'}
          </a>
        )}
      </section>
      <div className="metric-grid">
        {[
          {
            label: 'Tiempo de hoy',
            value: duration(daily.totalMinutes),
            note: `${daily.sessionCount} ${daily.sessionCount === 1 ? 'sesión registrada' : 'sesiones registradas'}`,
            icon: Clock3,
          },
          {
            label: 'Esta semana',
            value: duration(weekly.totalMinutes),
            note: 'Desde el lunes, a tu ritmo',
            icon: Activity,
          },
          {
            label: 'Áreas cultivadas',
            value: String(weekly.areaCount),
            note: 'Con actividad esta semana',
            icon: Layers3,
          },
          {
            label: 'Intereses atendidos',
            value: String(weekly.interestCount),
            note: 'Con actividad esta semana',
            icon: Sprout,
          },
        ].map((metric) => (
          <div className="card metric" key={metric.label}>
            <div className="metric-label">
              <metric.icon size={15} className="metric-icon" />
              {metric.label}
            </div>
            <div className="metric-value">{metric.value}</div>
            <div className="metric-note">{metric.note}</div>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="dashboard-main">
          <section className="card">
            <div className="section-heading">
              <h2>Lo que hiciste hoy</h2>
              <a href="/activities">
                Ver historial <ArrowUpRight size={12} style={{ display: 'inline' }} />
              </a>
            </div>
            {activities.length > 0 ? (
              <div className="row-list">
                {activities.map((activity) => (
                  <a className="list-row" href={`/activities?id=${activity.id}`} key={activity.id}>
                    <div className="row-leading">
                      <div className="row-icon">
                        <Activity size={17} />
                      </div>
                      <div>
                        <div className="row-title">{activity.name}</div>
                        <div className="row-subtitle">
                          {activity.interestIds
                            ?.map((id) => records.find((record) => record.id === id)?.name)
                            .filter(Boolean)
                            .join(' · ') || 'Actividad personal'}{' '}
                          ·{' '}
                          {new Intl.DateTimeFormat('es-PE', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: settings.timezone,
                          }).format(new Date(activity.occurredAt!))}
                        </div>
                      </div>
                    </div>
                    <span className="row-value">{duration(activity.durationMinutes ?? 0)}</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Activity size={30} />
                <h3>Tu día todavía está por contar</h3>
                <p>
                  Una lectura, un entrenamiento o un rato de curiosidad. Todo lo que cultivas tiene
                  un lugar aquí.
                </p>
                <a className="button button-secondary" href="/activities?new=1">
                  <Plus size={14} />
                  Registrar mi primera sesión
                </a>
              </div>
            )}
          </section>
          <section className="card">
            <div className="section-heading">
              <h2>Un poco de atención</h2>
              <a href="/attention">Abrir radar →</a>
            </div>
            {neglected.length > 0 ? (
              <div className="row-list">
                {neglected.map(({ interest, attention }) => (
                  <a className="list-row" href={`/interests?id=${interest.id}`} key={interest.id}>
                    <div className="row-leading">
                      <div
                        className="row-icon"
                        style={{
                          background:
                            attention.state === 'neglected' ? 'var(--warning-soft)' : undefined,
                          color: attention.state === 'neglected' ? 'var(--warning)' : undefined,
                        }}
                      >
                        <Compass size={17} />
                      </div>
                      <div>
                        <div className="row-title">{interest.name}</div>
                        <div className="row-subtitle">
                          {attention.daysSinceLast === null
                            ? 'Todavía sin sesiones'
                            : `Hace ${Math.floor(attention.daysSinceLast)} días`}{' '}
                          · Cada {attention.frequencyDays} días
                        </div>
                      </div>
                    </div>
                    <span className={`badge badge-${attention.state}`}>{attention.label}</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="empty-state empty-state-small">
                <Compass size={29} />
                <h3>
                  {hasInterests ? 'Todo tiene su propio ritmo' : 'Un radar hecho a tu medida'}
                </h3>
                <p>
                  {hasInterests
                    ? 'No hay intereses desatendidos o próximos a vencer. Puedes explorar tu radar para ver el detalle.'
                    : 'Configura la frecuencia de tus intereses para saber cuándo conviene retomarlos.'}
                </p>
              </div>
            )}
          </section>
          <section className="card">
            <div className="section-heading">
              <h2>Proyectos en movimiento</h2>
              <a href="/projects">Ver proyectos →</a>
            </div>
            {projects.length > 0 ? (
              <div className="row-list">
                {projects.map((project) => {
                  const metric = projectMetric(project, records);
                  return (
                    <a
                      className="list-row"
                      href={`/projects?id=${project.id}`}
                      key={project.id}
                      style={{ display: 'block' }}
                    >
                      <div className="inline" style={{ justifyContent: 'space-between' }}>
                        <span className="row-title">{project.name}</span>
                        <span className="badge">En progreso</span>
                      </div>
                      <div className="row-subtitle">
                        {metric.totalMilestones
                          ? `${metric.completedMilestones} de ${metric.totalMilestones} hitos completados`
                          : 'Sin hitos definidos todavía'}
                      </div>
                      {metric.progress !== null && (
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{ width: `${metric.progress * 100}%` }}
                          />
                        </div>
                      )}
                    </a>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state empty-state-small">
                <FolderKanban size={28} />
                <p>
                  No hay proyectos en marcha. Cuando quieras dar forma a una idea, empieza aquí.
                </p>
                <a className="text-link" href="/projects?new=1">
                  Crear un proyecto →
                </a>
              </div>
            )}
          </section>
        </div>
        <div className="dashboard-side">
          <section className="card">
            <div className="section-heading">
              <h2>Hábitos pendientes</h2>
              <a href="/habits" aria-label="Ver todos los hábitos">
                <ArrowUpRight size={17} />
              </a>
            </div>
            {pendingHabits.length > 0 ? (
              <div className="row-list">
                {pendingHabits.map(({ habit, progress }) => (
                  <a
                    className="list-row"
                    key={habit.id}
                    href={`/activities?new=1&habit=${habit.id}`}
                  >
                    <div>
                      <div className="row-title">{habit.name}</div>
                      <div className="row-subtitle">
                        {progress.targetMinutes
                          ? `${Math.round(progress.minutes)} / ${progress.targetMinutes} min`
                          : `${progress.sessions} / ${progress.targetCount} sesiones`}{' '}
                        este período
                      </div>
                    </div>
                    <Plus size={17} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  </a>
                ))}
              </div>
            ) : (
              <div className="empty-state empty-state-small">
                <Repeat2 size={27} />
                <p>
                  {records.some((record) => record.type === 'habits')
                    ? 'Sin hábitos pendientes para este período.'
                    : 'Crea hábitos con frecuencias que se adapten a tu vida.'}
                </p>
                <a href="/habits" className="text-link">
                  Explorar hábitos →
                </a>
              </div>
            )}
          </section>
          <section className="card">
            <div className="section-heading">
              <h2>Tu norte</h2>
              <Target size={17} className="muted" />
            </div>
            {goals.length > 0 ? (
              <div className="row-list">
                {goals.map((goal) => {
                  const metric = goalMetric(goal, records, now);
                  return (
                    <a
                      className="list-row"
                      href={`/goals?id=${goal.id}`}
                      key={goal.id}
                      style={{ display: 'block' }}
                    >
                      <div className="row-title">{goal.name}</div>
                      {goal.targetValue !== undefined && goal.targetValue > 0 ? (
                        <>
                          <div className="row-subtitle">
                            {metric.currentValue === null ? 'Sin mediciones' : metric.currentValue}{' '}
                            / {goal.targetValue} {goal.unit ?? ''}
                          </div>
                          {metric.progress !== null && (
                            <div className="progress-track">
                              <div
                                className="progress-fill"
                                style={{
                                  width: `${metric.progress * 100}%`,
                                }}
                              />
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="row-subtitle">
                          {goal.outcomes || 'Resultado pendiente de definir'}
                        </div>
                      )}
                    </a>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state empty-state-small">
                <Target size={28} />
                <p>¿Hacia dónde quieres ir? Define resultados que tengan sentido para ti.</p>
                <a className="text-link" href="/goals?new=1">
                  Establecer un objetivo →
                </a>
              </div>
            )}
          </section>
          <section className="card card-soft">
            <p className="eyebrow">Una pausa para mirar</p>
            <h2 style={{ marginBottom: 10 }}>Cada semana, una nueva perspectiva.</h2>
            <p className="muted" style={{ fontSize: 12 }}>
              Revisa lo que cultivaste, reconoce los avances y elige qué merece tu atención.
            </p>
            <a className="text-link" href="/reviews?new=1">
              Hacer mi revisión semanal →
            </a>
          </section>
        </div>
      </div>
    </>
  );
}
