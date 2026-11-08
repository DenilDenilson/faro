import { useEffect, useState } from 'react';
import { Download, Upload, Save, ShieldCheck, Database, CheckCircle } from 'lucide-react';
import type { FaroBackup, FaroSnapshot, ImportPreview, Settings } from '../lib/types';

const ALERT_LABELS = {
  interest: 'Intereses desatendidos',
  habit: 'Hábitos pendientes',
  review: 'Revisión semanal',
  goal: 'Fechas de objetivos',
  project: 'Proyectos sin actividad',
} as const;
export default function SettingsPanel({ snapshot }: { snapshot: FaroSnapshot }) {
  const [settings, setSettings] = useState<Settings>(snapshot.settings);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [backup, setBackup] = useState<FaroBackup | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewToken, setPreviewToken] = useState('');
  const [restoreSettings, setRestoreSettings] = useState(false);
  useEffect(() => {
    setReady(true);
    if (new URLSearchParams(window.location.search).get('imported') === '1')
      setMessage('Importación completada y preferencias restauradas.');
  }, []);
  async function request<T>(url: string, method: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as { ok: boolean; data?: T; error?: string };
    if (!response.ok || !result.ok)
      throw new Error(result.error ?? 'No se pudo completar la operación.');
    return result.data as T;
  }
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request(
        '/api/settings',
        'PUT',
        Object.fromEntries(
          Object.entries(settings).filter(
            ([key]) => !['dismissedAlerts', 'snoozedAlerts'].includes(key),
          ),
        ),
      );
      document.documentElement.dataset.theme = settings.theme;
      setMessage(
        'Preferencias guardadas. Se aplicarán en tus dispositivos al abrir la aplicación.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron guardar las preferencias.');
    } finally {
      setBusy(false);
    }
  }
  async function inspect(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('');
    setPreview(null);
    setBackup(null);
    try {
      if (file.size > 4 * 1024 * 1024)
        throw new Error(
          'El archivo supera 4 MB. Usa la herramienta de restauración local documentada en el repositorio.',
        );
      const parsed = JSON.parse(await file.text()) as FaroBackup;
      const result = await request<{ preview: ImportPreview; previewToken: string }>(
        '/api/data/import',
        'POST',
        { mode: 'preview', data: parsed },
      );
      setBackup(parsed);
      setPreview(result.preview);
      setPreviewToken(result.previewToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'El respaldo no es válido.');
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (
      !backup ||
      !preview ||
      !window.confirm(
        `¿Importar ${preview.newRecords} registros nuevos? Los existentes se conservarán.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request('/api/data/import', 'POST', {
        mode: 'confirm',
        data: backup,
        previewToken,
        restoreSettings,
      });
      setMessage('Importación completada. Los registros existentes se conservaron.');
      setPreview(null);
      setBackup(null);
      if (restoreSettings) window.location.assign('/settings?imported=1');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo importar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-grid">
      {error && (
        <p className="error settings-feedback" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success settings-feedback" role="status">
          <CheckCircle size={17} />
          {message}
        </p>
      )}
      <form className="panel stack" onSubmit={save}>
        <fieldset
          disabled={!ready}
          className="stack"
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <legend className="sr-only">Preferencias de FARO</legend>
          <div>
            <span className="eyebrow">A tu medida</span>
            <h2>Preferencias</h2>
            <p className="muted">Elige cómo quieres observar tu vida.</p>
          </div>
          <label className="field">
            Tema
            <select
              value={settings.theme}
              onChange={(e) =>
                setSettings({ ...settings, theme: e.target.value as Settings['theme'] })
              }
            >
              <option value="system">Automático</option>
              <option value="light">Claro</option>
              <option value="dark">Oscuro</option>
            </select>
          </label>
          <label className="field">
            Zona horaria
            <input
              value={settings.timezone}
              onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
              required
              list="timezones"
              placeholder="America/Lima"
            />
            <datalist id="timezones">
              {[
                'America/Lima',
                'America/Bogota',
                'America/Mexico_City',
                'America/Argentina/Buenos_Aires',
                'America/New_York',
                'Europe/Madrid',
                'UTC',
              ].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <small className="muted">
              Determina el inicio del día, la semana y los períodos de hábitos.
            </small>
          </label>
          <label className="field">
            Avisar al alcanzar esta fracción de la frecuencia
            <input
              type="number"
              min="0.1"
              max="1"
              step="0.05"
              value={settings.attentionWarningRatio}
              onChange={(e) =>
                setSettings({ ...settings, attentionWarningRatio: Number(e.target.value) })
              }
            />
            <small className="muted">
              0,8 avisa al transcurrir el 80 % del intervalo propio de cada interés.
            </small>
          </label>
          <label className="field">
            Proyecto inactivo: días antes del aviso
            <input
              type="number"
              min="1"
              max="3650"
              value={settings.projectIdleDays}
              onChange={(e) =>
                setSettings({ ...settings, projectIdleDays: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            Objetivo próximo: días de anticipación
            <input
              type="number"
              min="1"
              max="365"
              value={settings.goalDueDays}
              onChange={(e) => setSettings({ ...settings, goalDueDays: Number(e.target.value) })}
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={settings.showStreaks}
              onChange={(e) => setSettings({ ...settings, showStreaks: e.target.checked })}
            />{' '}
            Mostrar rachas opcionales de hábitos
          </label>
          <fieldset className="stack">
            <legend>Alertas dentro de FARO</legend>
            {Object.entries(ALERT_LABELS).map(([type, label]) => (
              <label key={type} className="checkbox-field">
                <input
                  type="checkbox"
                  checked={settings.alertPreferences[type as keyof typeof ALERT_LABELS]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      alertPreferences: { ...settings.alertPreferences, [type]: e.target.checked },
                    })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <button className="button primary" disabled={busy}>
            <Save size={16} />
            {busy ? 'Guardando…' : 'Guardar preferencias'}
          </button>
        </fieldset>
      </form>
      <div className="stack">
        <section className="panel stack">
          <div>
            <span className="eyebrow">Tu información te pertenece</span>
            <h2>
              <Database size={21} /> Datos y respaldos
            </h2>
          </div>
          <p>
            El respaldo JSON incluye registros, relaciones, preferencias e historial de cambios.
            Guárdalo periódicamente en un lugar privado.
          </p>
          <a href="/api/data/export" className="button" download>
            <Download size={16} />
            Exportar todos mis datos
          </a>
          <label className="field">
            Importar respaldo JSON
            <input
              type="file"
              accept="application/json,.json"
              disabled={!ready || busy}
              onChange={(e) => void inspect(e.target.files?.[0])}
            />
          </label>
          <p className="muted small">
            Antes de importar verás una previsualización. Los duplicados se omiten y los registros
            en conflicto se conservan.
          </p>
          {preview && (
            <div className="import-preview stack">
              <h3>Previsualización del respaldo</h3>
              <dl className="summary-list">
                <div>
                  <dt>Registros totales</dt>
                  <dd>{preview.total}</dd>
                </div>
                <div>
                  <dt>Nuevos</dt>
                  <dd>{preview.newRecords}</dd>
                </div>
                <div>
                  <dt>Duplicados</dt>
                  <dd>{preview.duplicates}</dd>
                </div>
                <div>
                  <dt>Conflictos conservados</dt>
                  <dd>{preview.conflicts}</dd>
                </div>
              </dl>
              {preview.warnings.map((warning, i) => (
                <p className="muted" key={i}>
                  {warning}
                </p>
              ))}
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={restoreSettings}
                  onChange={(e) => setRestoreSettings(e.target.checked)}
                />
                Restaurar también las preferencias del respaldo
              </label>
              <button className="button primary" disabled={busy} onClick={() => void restore()}>
                <Upload size={16} />
                Confirmar importación
              </button>
              <button
                className="button subtle"
                onClick={() => {
                  setPreview(null);
                  setBackup(null);
                }}
              >
                Cancelar importación
              </button>
            </div>
          )}
        </section>
        <section className="panel stack">
          <h2>
            <ShieldCheck size={21} /> Acceso privado
          </h2>
          <p>
            FARO protege tus datos con una contraseña de acceso y una sesión segura. La contraseña y
            las credenciales de la base se configuran en el servidor.
          </p>
          <p className="muted">Para terminar la sesión, usa «Cerrar sesión» en el menú.</p>
        </section>
        <section className="panel stack">
          <h2>
            FARO <span className="badge">1.0.0</span>
          </h2>
          <p>Una perspectiva más clara de lo que cultivas.</p>
          <a href="https://github.com/DenilDenilson/faro" target="_blank" rel="noreferrer">
            Código y documentación ↗
          </a>
        </section>
      </div>
    </div>
  );
}
