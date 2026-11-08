import { useState } from 'react';
import {
  Bell,
  BellOff,
  Clock3,
  Compass,
  Target,
  Repeat2,
  FolderKanban,
  CalendarCheck2,
  Check,
} from 'lucide-react';
import type { AlertType } from '../lib/types';
import type { FaroAlert } from '../domains/notifications';
const icons = {
  interest: Compass,
  habit: Repeat2,
  review: CalendarCheck2,
  goal: Target,
  project: FolderKanban,
};
const labels: Record<AlertType, string> = {
  interest: 'Intereses',
  habit: 'Hábitos',
  review: 'Revisión semanal',
  goal: 'Objetivos',
  project: 'Proyectos',
};
export default function Alerts({ initialAlerts }: { initialAlerts: FaroAlert[] }) {
  const [type, setType] = useState('all');
  const [hidden, setHidden] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const alerts = initialAlerts;
  const visible = alerts.filter(
    (alert) => !hidden.includes(alert.id) && (type === 'all' || alert.type === type),
  );
  async function act(id: string, action: 'dismiss' | 'snooze') {
    setBusy(id);
    setError('');
    try {
      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
        credentials: 'same-origin',
      });
      const result = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !result.ok)
        throw new Error(result.error || 'No se pudo actualizar la alerta.');
      setHidden((previous) => [...previous, id]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la alerta.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="stack">
      <div className="callout inline">
        <Bell size={18} style={{ flexShrink: 0 }} />
        <span>
          Señales para decidir, sin presión. Cada alerta corresponde a una condición real. Puedes
          descartarla o posponerla 24 horas.
        </span>
      </div>
      <div className="filter-bar" style={{ marginBottom: 0 }}>
        <label className="field" style={{ margin: 0 }}>
          Mostrar
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">Todas las alertas</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <a className="text-link" href="/settings" style={{ paddingBottom: 11, marginLeft: 'auto' }}>
          Configurar tipos de alerta →
        </a>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {visible.length > 0 ? (
        visible.map((alert) => {
          const Icon = icons[alert.type];
          return (
            <article className="card alert-card" key={alert.id}>
              <div
                className="row-icon"
                style={
                  alert.severity === 'warning'
                    ? { background: 'var(--warning-soft)', color: 'var(--warning)' }
                    : undefined
                }
              >
                <Icon size={19} />
              </div>
              <div className="alert-body">
                <div className="inline" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <h3 style={{ margin: 0 }}>{alert.title}</h3>
                  <span className={`badge ${alert.severity === 'warning' ? 'badge-warning' : ''}`}>
                    {labels[alert.type]}
                  </span>
                </div>
                <p>{alert.message}</p>
                <div className="alert-actions">
                  <a className="button button-secondary" href={alert.href}>
                    Ver detalle
                  </a>
                  <button
                    className="button button-ghost"
                    type="button"
                    disabled={busy === alert.id}
                    onClick={() => void act(alert.id, 'snooze')}
                  >
                    <Clock3 size={13} />
                    Posponer 24 h
                  </button>
                  <button
                    className="button button-ghost"
                    type="button"
                    disabled={busy === alert.id}
                    onClick={() => void act(alert.id, 'dismiss')}
                  >
                    <Check size={13} />
                    Descartar
                  </button>
                </div>
              </div>
            </article>
          );
        })
      ) : (
        <section className="card empty-state">
          <BellOff size={39} />
          <h2>Un poco de tranquilidad</h2>
          <p>
            No hay alertas pendientes con estos filtros. FARO te mostrará señales cuando tus datos
            indiquen que algo merece atención.
          </p>
          <a className="button button-secondary" href="/attention">
            Explorar mi radar
          </a>
        </section>
      )}
    </div>
  );
}
