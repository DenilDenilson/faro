import { useState } from 'react';
import { Compass, Pause, Plus, Search, Info } from 'lucide-react';
import type { FaroRecord, FaroSnapshot } from '../lib/types';
import type { AttentionResult } from '../domains/attention';

export default function AttentionRadar({
  snapshot,
  initialRows,
}: {
  snapshot: FaroSnapshot;
  initialRows: Array<{ interest: FaroRecord; attention: AttentionResult }>;
}) {
  const [state, setState] = useState('all');
  const [area, setArea] = useState('all');
  const [search, setSearch] = useState('');
  const interests = initialRows.map((row) => row.interest);
  const areas = snapshot.records.filter((record) => record.type === 'areas');
  const radar = initialRows;
  const filtered = radar.filter(
    ({ interest, attention }) =>
      (state === 'all' || attention.state === state) &&
      (area === 'all' || interest.areaId === area) &&
      interest.name.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')),
  );
  const states = [
    ['all', 'Todos'],
    ['current', 'Al día'],
    ['due', 'Próximo a vencer'],
    ['neglected', 'Desatendido'],
    ['paused', 'En pausa'],
    ['insufficient', 'Sin datos'],
  ] as const;
  return (
    <div className="stack">
      <div className="callout inline">
        <Info size={18} style={{ flexShrink: 0 }} />
        <span>
          Cada interés tiene su propio ritmo. El radar compara la última sesión con su frecuencia;
          las pausas se respetan y las temporadas contextualizan tus prioridades.
        </span>
      </div>
      <div className="attention-summary">
        {states.slice(1).map(([value, label]) => (
          <button
            type="button"
            className={`badge badge-${value}`}
            style={{
              border: state === value ? '1px solid currentColor' : '1px solid transparent',
              cursor: 'pointer',
            }}
            onClick={() => setState(state === value ? 'all' : value)}
            key={value}
          >
            {label} · {radar.filter((row) => row.attention.state === value).length}
          </button>
        ))}
      </div>
      <div className="filter-bar">
        <label className="field search-field">
          Buscar interés
          <div style={{ position: 'relative' }}>
            <Search
              size={16}
              style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted)' }}
            />
            <input
              aria-label="Buscar interés"
              style={{ paddingLeft: 37 }}
              placeholder="¿Qué quieres retomar?"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </label>
        <label className="field">
          Área
          <select value={area} onChange={(event) => setArea(event.target.value)}>
            <option value="all">Todas las áreas</option>
            {areas.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Atención
          <select value={state} onChange={(event) => setState(event.target.value)}>
            {states.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {interests.length === 0 ? (
        <div className="card empty-state">
          <Compass size={40} />
          <h2>Tu radar empieza con tus intereses</h2>
          <p>
            Indica qué te gusta cultivar y cada cuánto quieres hacerlo. No es necesario crear
            hábitos ni proyectos.
          </p>
          <a className="button button-primary" href="/interests?new=1">
            <Plus size={15} />
            Crear mi primer interés
          </a>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card empty-state">
          <Search size={32} />
          <h3>No hay intereses con estos filtros</h3>
          <p>Prueba con otra área o estado de atención.</p>
        </div>
      ) : (
        areas
          .concat([
            {
              id: 'unassigned',
              name: 'Sin área',
              type: 'areas',
              description: '',
              status: 'active',
              createdAt: '',
              updatedAt: '',
            },
          ])
          .map((areaRecord) => {
            const rows = filtered.filter(({ interest }) =>
              areaRecord.id === 'unassigned' ? !interest.areaId : interest.areaId === areaRecord.id,
            );
            return (
              rows.length > 0 && (
                <section key={areaRecord.id}>
                  <div className="section-heading">
                    <h2 className="inline">
                      <span
                        className="color-dot"
                        style={{ background: areaRecord.color || 'var(--accent)' }}
                      />
                      {areaRecord.name}
                    </h2>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {rows.length} {rows.length === 1 ? 'interés' : 'intereses'}
                    </span>
                  </div>
                  <div className="attention-grid">
                    {rows.map(({ interest, attention }) => (
                      <article
                        className="card attention-card"
                        data-state={attention.state}
                        key={interest.id}
                      >
                        <div className="section-heading">
                          <h3>
                            <a href={`/interests?id=${interest.id}`}>{interest.name}</a>
                          </h3>
                          <span className={`badge badge-${attention.state}`}>
                            {attention.state === 'paused' && <Pause size={10} />} {attention.label}
                          </span>
                        </div>
                        <div className="attention-days">
                          {attention.daysSinceLast === null
                            ? 'Sin sesiones'
                            : Math.floor(attention.daysSinceLast)}
                          {attention.daysSinceLast !== null && (
                            <span>
                              {Math.floor(attention.daysSinceLast) === 1
                                ? 'día sin practicar'
                                : 'días sin practicar'}
                            </span>
                          )}
                        </div>
                        <p
                          className="muted"
                          style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 15 }}
                        >
                          {attention.reason}
                        </p>
                        <div className="inline" style={{ justifyContent: 'space-between' }}>
                          <span className="badge">
                            Cada {attention.frequencyDays}{' '}
                            {attention.frequencyDays === 1 ? 'día' : 'días'}
                          </span>
                          <a
                            className="text-link"
                            href={`/activities?new=1&interest=${interest.id}`}
                          >
                            Registrar sesión →
                          </a>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )
            );
          })
      )}
      <details className="card">
        <summary style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Cómo se calcula tu atención
        </summary>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.8, marginTop: 14 }}>
          <p>
            Se utiliza la frecuencia de cada interés y su última sesión, en tu zona horaria. Antes
            del umbral de aviso estás al día; después, el interés se aproxima a su frecuencia
            deseada. Al alcanzar esa frecuencia, aparece como desatendido.
          </p>
          <p>
            La proporción de aviso se configura en Preferencias. Los intereses pausados no generan
            alertas. Cuando todavía no existen sesiones, FARO muestra la falta de datos y el tiempo
            desde que comenzaste a seguir el interés, sin inventar una puntuación de habilidad.
          </p>
          <a className="text-link" href="/settings">
            Ajustar reglas de atención →
          </a>
        </div>
      </details>
    </div>
  );
}
