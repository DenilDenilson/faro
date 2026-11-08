import { useEffect, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  Clock3,
  Info,
  Layers3,
  Sprout,
} from 'lucide-react';
import type { FaroSnapshot } from '../lib/types';
import type { AnalyticsResult, TimeDistribution } from '../domains/analytics';
import { addDays, dateKey } from '../domains/analytics/dates';
import { formatMinutes as duration } from '../lib/client';

const palette = [
  '#176454',
  '#6e9c78',
  '#b7a36d',
  '#8b9bb2',
  '#bc8f7a',
  '#8c78a0',
  '#91b5ab',
  '#c5ba9c',
];
const shortDate = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-PE', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
function Distribution({ data, title }: { data: TimeDistribution[]; title: string }) {
  return (
    <section className="card chart-card">
      <div className="section-heading">
        <h2>{title}</h2>
        <span className="badge">Tiempo dedicado</span>
      </div>
      {data.length ? (
        <>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.map((item, index) => ({
                    ...item,
                    fill: item.color === '#8b9490' ? palette[index % palette.length] : item.color,
                  }))}
                  dataKey="minutes"
                  nameKey="name"
                  innerRadius="57%"
                  outerRadius="82%"
                  paddingAngle={3}
                  stroke="none"
                />
                <Tooltip formatter={(value) => duration(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            {data.map((item, index) => (
              <span key={item.id}>
                <i
                  className="color-dot"
                  style={{
                    background:
                      item.color === '#8b9490' ? palette[index % palette.length] : item.color,
                  }}
                />
                {item.name} · {duration(item.minutes)}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="empty-state empty-state-small">
          <p>Sin tiempo registrado en este período.</p>
        </div>
      )}
    </section>
  );
}
export default function Analytics({
  snapshot,
  initialStats,
}: {
  snapshot: FaroSnapshot;
  initialStats: AnalyticsResult;
}) {
  const now = new Date(snapshot.generatedAt);
  const today = dateKey(now, snapshot.settings.timezone);
  const [period, setPeriod] = useState('30');
  const [start, setStart] = useState(addDays(today, -29));
  const [end, setEnd] = useState(today);
  const [area, setArea] = useState('');
  const [interest, setInterest] = useState('');
  const [group, setGroup] = useState<'daily' | 'weekly' | 'monthly' | 'annual'>('daily');
  const [stats, setStats] = useState(initialStats);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const firstRender = useRef(true);
  const startDate =
    period === 'custom' ? start : period === 'all' ? '' : addDays(today, -Number(period) + 1);
  const endDate = period === 'custom' ? end : today;
  const validDates = period === 'all' || Boolean(startDate && endDate && startDate <= endDate);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!validDates) return;
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (period === 'all') query.set('all', '1');
    else query.set('startDate', startDate);
    query.set('endDate', endDate);
    if (area) query.set('areaId', area);
    if (interest) query.set('interestId', interest);
    setLoading(true);
    setError('');
    void fetch(`/api/analytics?${query}`, { signal: controller.signal, credentials: 'same-origin' })
      .then(async (response) => {
        const result = (await response.json()) as {
          ok: boolean;
          data?: AnalyticsResult;
          error?: string;
        };
        if (!response.ok || !result.ok || !result.data)
          throw new Error(result.error || 'No se pudieron actualizar las estadísticas.');
        setStats(result.data);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : 'No se pudieron actualizar las estadísticas.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [period, startDate, endDate, area, interest, validDates]);
  const areas = snapshot.records.filter((record) => record.type === 'areas');
  const interests = snapshot.records.filter(
    (record) => record.type === 'interests' && (!area || record.areaId === area),
  );
  const heatmap = stats.heatmap.slice(-91);
  const heatMax = Math.max(1, ...heatmap.map((point) => point.minutes));
  const selectedSeries = stats[group];
  return (
    <div aria-busy={!ready || loading}>
      {loading && (
        <p className="muted small" role="status">
          Consultando tu historial…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error} Se conservan los resultados de {stats.startDate} a {stats.endDate}.
        </p>
      )}
      <div className="filter-bar">
        <label className="field">
          Período
          <select
            disabled={!ready}
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value);
              if (event.target.value === '365' || event.target.value === 'all') setGroup('monthly');
            }}
          >
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
            <option value="365">Últimos 12 meses</option>
            <option value="all">Todo mi historial</option>
            <option value="custom">Fechas personalizadas</option>
          </select>
        </label>
        {period === 'custom' && (
          <>
            <label className="field">
              Desde
              <input
                disabled={!ready}
                type="date"
                value={start}
                max={end || today}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
            <label className="field">
              Hasta
              <input
                disabled={!ready}
                type="date"
                value={end}
                min={start}
                max={today}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          </>
        )}
        <label className="field">
          Área
          <select
            disabled={!ready}
            value={area}
            onChange={(event) => {
              setArea(event.target.value);
              setInterest('');
            }}
          >
            <option value="">Todas las áreas</option>
            {areas.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Interés
          <select
            disabled={!ready}
            value={interest}
            onChange={(event) => setInterest(event.target.value)}
          >
            <option value="">Todos los intereses</option>
            {interests.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!validDates && (
        <p className="form-error" role="alert">
          Elige un intervalo de fechas válido.
        </p>
      )}
      <div className="metric-grid">
        {[
          {
            label: 'Tiempo dedicado',
            value: duration(stats.totalMinutes),
            note: stats.hasData
              ? `${stats.sessionCount} sesiones únicas`
              : 'Sin sesiones en este período',
            icon: Clock3,
          },
          {
            label: 'Constancia',
            value: `${stats.activeDays} días`,
            note: 'Días con al menos una sesión',
            icon: CalendarDays,
          },
          {
            label: 'Intereses atendidos',
            value: String(stats.interestCount),
            note: 'Diversidad de atención',
            icon: Sprout,
          },
          {
            label: 'Áreas cultivadas',
            value: String(stats.areaCount),
            note: 'Dimensiones con actividad',
            icon: Layers3,
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
      <div className="callout inline" style={{ marginBottom: 22 }}>
        <Info size={18} style={{ flexShrink: 0 }} />
        <span>
          El tiempo mide dedicación, no habilidad. Una sesión se suma una sola vez; si tiene varios
          intereses, su duración se distribuye entre ellos para conservar el total.
        </span>
      </div>
      {!stats.hasData ? (
        <section className="card empty-state" style={{ marginBottom: 22 }}>
          <ChartNoAxesCombined size={38} />
          <h2>Tus datos irán contando una historia</h2>
          <p>
            No hay sesiones en este período. Prueba otras fechas o registra una actividad para
            empezar a ver tus tendencias.
          </p>
          <a href="/activities?new=1" className="button button-primary">
            Registrar actividad
          </a>
        </section>
      ) : (
        <>
          <section className="card chart-card" style={{ marginBottom: 22 }}>
            <div className="section-heading">
              <div>
                <h2>Tu ritmo de actividad</h2>
                <p className="muted" style={{ fontSize: 11, marginTop: 5 }}>
                  {shortDate(stats.startDate)} — {shortDate(stats.endDate)} ·{' '}
                  {stats.startDate.slice(0, 4)}
                </p>
              </div>
              <label className="field" style={{ margin: 0, minWidth: 115 }}>
                <span className="sr-only">Agrupar actividad</span>
                <select
                  disabled={!ready}
                  aria-label="Agrupar actividad"
                  value={group}
                  onChange={(event) => setGroup(event.target.value as typeof group)}
                >
                  <option value="daily">Por día</option>
                  <option value="weekly">Por semana</option>
                  <option value="monthly">Por mes</option>
                  <option value="annual">Por año</option>
                </select>
              </label>
            </div>
            <div className="chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={selectedSeries}
                  margin={{ top: 10, right: 10, left: -22, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value) =>
                      group === 'annual' ? String(value).slice(0, 4) : shortDate(String(value))
                    }
                    axisLine={false}
                    tickLine={false}
                    minTickGap={30}
                  />
                  <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `${value}m`} />
                  <Tooltip
                    labelFormatter={(label) =>
                      group === 'annual' ? String(label).slice(0, 4) : shortDate(String(label))
                    }
                    formatter={(value, name) => [
                      name === 'minutes' ? duration(Number(value)) : String(value),
                      name === 'minutes' ? 'Tiempo' : 'Sesiones',
                    ]}
                  />
                  <Bar
                    dataKey="minutes"
                    fill="var(--accent)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={38}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div
              className="inline"
              style={{ justifyContent: 'space-between', marginTop: 17, fontSize: 12 }}
            >
              <span className="muted">
                Período anterior de igual duración: {duration(stats.previousMinutes)}
              </span>
              <span
                className="inline"
                style={{
                  gap: 5,
                  color: stats.deltaMinutes >= 0 ? 'var(--accent)' : 'var(--muted)',
                }}
              >
                {stats.deltaMinutes >= 0 ? (
                  <ArrowUpRight size={15} />
                ) : (
                  <ArrowDownRight size={15} />
                )}{' '}
                {stats.deltaMinutes >= 0 ? '+' : '−'}
                {duration(Math.abs(stats.deltaMinutes))}
              </span>
            </div>
          </section>
          <div className="chart-grid">
            <Distribution data={stats.byArea} title="Por áreas de vida" />
            <Distribution data={stats.byInterest} title="Por intereses" />
          </div>
          <div className="chart-grid">
            <section className="card chart-card">
              <div className="section-heading">
                <h2>Tiempo por proyecto</h2>
              </div>
              <div className="chart-area">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={stats.byProject}
                    layout="vertical"
                    margin={{ left: 0, right: 14 }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 4" />
                    <XAxis
                      type="number"
                      tickFormatter={(value) => `${value}m`}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={100}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) =>
                        String(value).length > 15 ? `${String(value).slice(0, 15)}…` : String(value)
                      }
                    />
                    <Tooltip formatter={(value) => [duration(Number(value)), 'Tiempo']} />
                    <Bar
                      dataKey="minutes"
                      fill="var(--accent)"
                      radius={[0, 4, 4, 0]}
                      maxBarSize={24}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="card chart-card">
              <div className="section-heading">
                <h2>Calendario de actividad</h2>
                <CalendarDays size={16} className="muted" />
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                Cada cuadro es un día. La intensidad representa minutos, no una calificación.
              </p>
              <div
                className="heatmap"
                role="img"
                aria-label={`Actividad de los últimos ${heatmap.length} días del período`}
              >
                {heatmap.map((point) => (
                  <div
                    className="heat-cell"
                    key={point.date}
                    data-level={
                      point.minutes === 0
                        ? 0
                        : Math.max(1, Math.ceil((point.minutes / heatMax) * 4))
                    }
                    title={`${point.date}: ${duration(point.minutes)}, ${point.sessions} sesiones`}
                    aria-label={`${point.date}: ${duration(point.minutes)}`}
                  />
                ))}
              </div>
              <div
                className="inline muted"
                style={{ justifyContent: 'space-between', fontSize: 10, marginTop: 14 }}
              >
                <span>{heatmap[0]?.date}</span>
                <span>{heatmap.at(-1)?.date}</span>
              </div>
              {stats.heatmap.length > 91 && (
                <p className="muted" style={{ fontSize: 10, marginTop: 10, marginBottom: 0 }}>
                  Se muestran los últimos 91 días del período seleccionado.
                </p>
              )}
            </section>
          </div>
          <section className="card chart-card" style={{ marginBottom: 22 }}>
            <div className="section-heading">
              <h2>Tendencia mensual</h2>
              <span className="badge">Tiempo · sesiones</span>
            </div>
            <div className="chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={stats.monthly}
                  margin={{ top: 15, right: 12, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value) =>
                      new Date(`${String(value)}T12:00:00Z`).toLocaleDateString('es-PE', {
                        month: 'short',
                        year: '2-digit',
                        timeZone: 'UTC',
                      })
                    }
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="minutes"
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `${value}m`}
                  />
                  <YAxis
                    yAxisId="sessions"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      name === 'minutes' ? duration(Number(value)) : `${value}`,
                      name === 'minutes' ? 'Tiempo' : 'Sesiones',
                    ]}
                  />
                  <Line
                    yAxisId="minutes"
                    type="monotone"
                    dataKey="minutes"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    yAxisId="sessions"
                    type="monotone"
                    dataKey="sessions"
                    stroke="#b7a36d"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-legend">
              <span>
                <i className="color-dot" style={{ background: 'var(--accent)' }} />
                Tiempo, eje izquierdo
              </span>
              <span>
                <i className="color-dot" style={{ background: '#b7a36d' }} />
                Sesiones, eje derecho
              </span>
            </div>
          </section>
        </>
      )}
      <div className="chart-grid">
        <section className="card">
          <div className="section-heading">
            <h2>Cumplimiento de hábitos</h2>
            <span className="badge">Períodos cumplidos</span>
          </div>
          {stats.habitCompletion.length ? (
            <div className="row-list">
              {stats.habitCompletion.map((habit) => (
                <a
                  href={`/habits?id=${habit.id}`}
                  className="list-row"
                  key={habit.id}
                  style={{ display: 'block' }}
                >
                  <div className="inline" style={{ justifyContent: 'space-between' }}>
                    <span className="row-title">{habit.name}</span>
                    <span className="badge">
                      {habit.completionRate === null
                        ? 'Sin períodos evaluables'
                        : `${Math.round(habit.completionRate * 100)} %`}
                    </span>
                  </div>
                  <div className="row-subtitle">
                    {habit.completedPeriods} de {habit.eligiblePeriods} períodos evaluables
                    cumplidos
                  </div>
                  {habit.completionRate !== null && (
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${habit.completionRate * 100}%` }}
                      />
                    </div>
                  )}
                </a>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 12 }}>
              No hay hábitos para estos filtros.
            </p>
          )}
        </section>
        <section className="card">
          <div className="section-heading">
            <h2>Progreso de proyectos</h2>
            <span className="badge">Hitos completados</span>
          </div>
          {stats.projectProgress.length ? (
            <div className="row-list">
              {stats.projectProgress.map((project) => (
                <a
                  href={`/projects?id=${project.id}`}
                  className="list-row"
                  key={project.id}
                  style={{ display: 'block' }}
                >
                  <div className="inline" style={{ justifyContent: 'space-between' }}>
                    <span className="row-title">{project.name}</span>
                    <span className="badge">
                      {project.progress === null
                        ? 'Sin hitos'
                        : `${Math.round(project.progress * 100)} %`}
                    </span>
                  </div>
                  <div className="row-subtitle">
                    {project.completedMilestones} de {project.totalMilestones} hitos
                  </div>
                  {project.progress !== null && (
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${project.progress * 100}%` }}
                      />
                    </div>
                  )}
                </a>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 12 }}>
              No hay proyectos para estos filtros.
            </p>
          )}
        </section>
      </div>
      <section className="card" style={{ marginBottom: 22 }}>
        <div className="section-heading">
          <h2>Resultados de tus objetivos</h2>
          <span className="badge">Indicadores medibles</span>
        </div>
        {stats.goalProgress.length ? (
          <div className="row-list">
            {stats.goalProgress.map((goal) => (
              <a
                href={`/goals?id=${goal.id}`}
                className="list-row"
                key={goal.id}
                style={{ display: 'block' }}
              >
                <div className="inline" style={{ justifyContent: 'space-between' }}>
                  <span className="row-title">{goal.name}</span>
                  <span className="badge">
                    {goal.currentValue === null
                      ? 'Sin avances medidos'
                      : `${goal.currentValue} ${goal.unit}`}
                    {goal.targetValue !== null ? ` / ${goal.targetValue} ${goal.unit}` : ''}
                  </span>
                </div>
                {goal.progress !== null && (
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${goal.progress * 100}%` }} />
                  </div>
                )}
                <div className="row-subtitle">
                  {goal.progress === null
                    ? 'Define un indicador y registra avances para medir este resultado.'
                    : `${Math.round(goal.progress * 100)} % del indicador · independiente del tiempo dedicado`}
                </div>
              </a>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 12 }}>
            No hay objetivos para estos filtros.
          </p>
        )}
      </section>
      <section className="card">
        <div className="section-heading">
          <h2>Evolución de la atención</h2>
          <span className="badge">Frecuencia observada</span>
        </div>
        {stats.attentionTrend.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Interés</th>
                  <th>Mes</th>
                  <th>Sesiones</th>
                  <th>Días activos</th>
                  <th>Intervalo observado</th>
                </tr>
              </thead>
              <tbody>
                {stats.attentionTrend.map((row) => (
                  <tr key={`${row.interestId}-${row.date}`}>
                    <td>{row.name}</td>
                    <td>{row.date.slice(0, 7)}</td>
                    <td>{row.sessions}</td>
                    <td>{row.activeDays}</td>
                    <td>
                      {row.averageGapDays === null
                        ? 'Sin datos suficientes'
                        : `${row.averageGapDays.toFixed(1)} días`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 12 }}>
            Las sesiones relacionadas con intereses mostrarán aquí su frecuencia real.
          </p>
        )}
      </section>
    </div>
  );
}
