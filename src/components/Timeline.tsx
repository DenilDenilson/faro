import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  CalendarCheck2,
  Flag,
  FolderCheck,
  History,
  Sprout,
  Target,
} from 'lucide-react';
import type { EntityType, FaroSnapshot } from '../lib/types';
import type { TimelineEvent } from '../domains/timeline';
const labels: Partial<Record<EntityType, string>> = {
  activities: 'Actividades',
  interests: 'Intereses',
  habits: 'Hábitos',
  projects: 'Proyectos terminados',
  goals: 'Objetivos alcanzados',
  learnings: 'Aprendizajes',
  seasons: 'Temporadas',
  reviews: 'Revisiones',
  milestones: 'Hitos',
  progress: 'Avances',
};
const icons = {
  activities: Activity,
  interests: Sprout,
  habits: Sprout,
  projects: FolderCheck,
  goals: Target,
  learnings: BookOpen,
  seasons: Flag,
  reviews: CalendarCheck2,
  milestones: FolderCheck,
  progress: Target,
  areas: Sprout,
};
export default function Timeline({
  snapshot,
  initialEvents,
  initialHasMore,
}: {
  snapshot: FaroSnapshot;
  initialEvents: TimelineEvent[];
  initialHasMore: boolean;
}) {
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('');
  const [page, setPage] = useState(1);
  const count = 20;
  const [events, setEvents] = useState(initialEvents);
  const [hasNextPage, setHasNextPage] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      offset: String((page - 1) * count),
      limit: String(count),
    });
    if (type) params.set('type', type);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (area) params.set('areaId', area);
    if (query) params.set('query', query);
    setLoading(true);
    setError('');
    void fetch(`/api/timeline?${params}`, { signal: controller.signal, credentials: 'same-origin' })
      .then(async (response) => {
        const result = (await response.json()) as {
          ok: boolean;
          data?: { events: TimelineEvent[]; hasMore: boolean };
          error?: string;
        };
        if (!response.ok || !result.ok || !result.data)
          throw new Error(result.error || 'No se pudo consultar el historial.');
        setEvents(result.data.events);
        setHasNextPage(result.data.hasMore);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'No se pudo consultar el historial.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [snapshot, type, from, to, query, area, page]);
  const displayed = events;
  const change = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };
  return (
    <div aria-busy={!ready || loading}>
      {loading && (
        <p className="muted small" role="status">
          Recorriendo tu historia…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="filter-bar">
        <label className="field search-field">
          Buscar en tu historia
          <input
            disabled={!ready}
            value={query}
            placeholder="Una idea, actividad o descubrimiento…"
            onChange={(event) => change(setQuery, event.target.value)}
          />
        </label>
        <label className="field">
          Tipo
          <select
            disabled={!ready}
            value={type}
            onChange={(event) => change(setType, event.target.value)}
          >
            <option value="">Toda mi evolución</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Área
          <select
            disabled={!ready}
            value={area}
            onChange={(event) => change(setArea, event.target.value)}
          >
            <option value="">Todas las áreas</option>
            {snapshot.records
              .filter((record) => record.type === 'areas')
              .map((record) => (
                <option key={record.id} value={record.id}>
                  {record.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Desde
          <input
            disabled={!ready}
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => change(setFrom, event.target.value)}
          />
        </label>
        <label className="field">
          Hasta
          <input
            disabled={!ready}
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => change(setTo, event.target.value)}
          />
        </label>
      </div>
      {events.length > 0 ? (
        <>
          <div className="section-heading">
            <span className="muted" style={{ fontSize: 12 }}>
              Página {page} de tu evolución
            </span>
            <span className="badge">Más reciente primero</span>
          </div>
          <div className="timeline-list">
            {displayed.map((event) => {
              const Icon = icons[event.type];
              return (
                <article className="card timeline-event" key={event.id}>
                  <time className="timeline-date" dateTime={event.date}>
                    {new Intl.DateTimeFormat('es-PE', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      timeZone: snapshot.settings.timezone,
                    }).format(
                      new Date(event.date.length === 10 ? `${event.date}T12:00:00Z` : event.date),
                    )}
                  </time>
                  <div className="timeline-body">
                    <div className="inline" style={{ gap: 8, marginBottom: 7 }}>
                      <Icon size={14} style={{ color: 'var(--accent)' }} />
                      <span className="eyebrow" style={{ fontSize: 9 }}>
                        {labels[event.type] || 'Tu vida'}
                      </span>
                    </div>
                    <h3>
                      <a href={event.href}>{event.title}</a>
                    </h3>
                    {event.description && <p>{event.description}</p>}
                  </div>
                  <a
                    href={event.href}
                    className="text-link"
                    style={{ whiteSpace: 'nowrap', fontSize: 11 }}
                  >
                    Ver detalle →
                  </a>
                </article>
              );
            })}
          </div>
          {(hasNextPage || page > 1) && (
            <nav className="pagination" aria-label="Paginación del historial">
              <button
                type="button"
                className="button"
                disabled={!ready || page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </button>
              <span>Página {page}</span>
              <button
                type="button"
                className="button"
                disabled={!ready || !hasNextPage}
                onClick={() => setPage(page + 1)}
              >
                Siguiente
              </button>
            </nav>
          )}
        </>
      ) : (
        <section className="card empty-state">
          <History size={40} />
          <h2>
            {snapshot.records.length
              ? 'No hay momentos con estos filtros'
              : 'Tu historia empieza aquí'}
          </h2>
          <p>
            Las actividades, descubrimientos, temporadas y logros que registres irán formando una
            memoria de tu evolución.
          </p>
          <a href="/activities?new=1" className="button button-primary">
            Registrar una actividad
          </a>
        </section>
      )}
    </div>
  );
}
