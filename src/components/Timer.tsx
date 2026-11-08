import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Timer as TimerIcon, Play, Pause, X, Save } from 'lucide-react';
import type { FaroSnapshot } from '../lib/types';
import {
  elapsedAt,
  formatElapsed,
  freshTimer,
  pauseTimer,
  readTimer,
  startTimer,
  type TimerState,
} from '../domains/activities/timer';
const STORAGE_KEY = 'faro.timer.v1';

export default function Timer({ snapshot }: { snapshot: FaroSnapshot }) {
  const [timer, setTimer] = useState<TimerState>(() => freshTimer());
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [name, setName] = useState('');
  const [interestId, setInterestId] = useState('');
  const [habitId, setHabitId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const stored = readTimer(localStorage.getItem(STORAGE_KEY));
    if (stored) setTimer(stored);
    setNow(Date.now());
    setReady(true);
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        const other = readTimer(event.newValue);
        if (other) setTimer(other);
      }
    };
    window.addEventListener('storage', sync);
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', sync);
    };
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify(timer));
  }, [timer, ready]);
  function update(next: TimerState) {
    setTimer(next);
    setNow(Date.now());
  }
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const durationMinutes = Math.round(elapsedAt(timer) / 600) / 100;
      if (durationMinutes <= 0) throw new Error('Registra al menos un segundo de actividad.');
      const response = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'activities',
          data: {
            name,
            description: '',
            status: 'active',
            occurredAt: timer.startedAt,
            durationMinutes,
            interestIds: interestId ? [interestId] : [],
            habitIds: habitId ? [habitId] : [],
            projectIds: projectId ? [projectId] : [],
            goalIds: goalId ? [goalId] : [],
            notes,
            idempotencyKey: timer.idempotencyKey,
          },
        }),
      });
      const result = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !result.ok)
        throw new Error(
          result.error ?? 'No se pudo guardar la actividad. Tu cronómetro sigue disponible.',
        );
      const cleared = freshTimer();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleared));
      setTimer(cleared);
      window.location.assign('/activities');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }
  const elapsed = ready ? elapsedAt(timer, now) : 0;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="button timer-trigger" type="button" disabled={!ready}>
          <TimerIcon size={17} />
          <span>{timer.status === 'idle' ? 'Cronómetro' : formatElapsed(elapsed)}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content timer-dialog">
          <Dialog.Title>Cronómetro</Dialog.Title>
          <Dialog.Description className="muted">
            El tiempo en pausa no se contabiliza. Al terminar podrás guardar la sesión.
          </Dialog.Description>
          <Dialog.Close asChild>
            <button className="dialog-close icon-button" aria-label="Cerrar cronómetro">
              <X size={20} />
            </button>
          </Dialog.Close>
          <div className="timer-display" role="timer" aria-label="Tiempo transcurrido">
            {formatElapsed(elapsed)}
          </div>
          <div className="button-row">
            {timer.status !== 'running' && (
              <button
                className="button primary"
                onClick={() => {
                  setFinishing(false);
                  update(startTimer(timer));
                }}
              >
                <Play size={16} />
                {timer.status === 'idle' ? 'Iniciar' : 'Continuar'}
              </button>
            )}
            {timer.status === 'running' && (
              <button className="button" onClick={() => update(pauseTimer(timer))}>
                <Pause size={16} />
                Pausar
              </button>
            )}
            {timer.status !== 'idle' && (
              <button
                className="button"
                onClick={() => {
                  update(pauseTimer(timer));
                  setFinishing(true);
                }}
              >
                Finalizar y registrar
              </button>
            )}
          </div>
          {finishing && (
            <form onSubmit={save} className="stack">
              <label className="field">
                Actividad realizada
                <input
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="¿Qué has hecho?"
                />
              </label>
              <label className="field">
                Interés
                <select value={interestId} required onChange={(e) => setInterestId(e.target.value)}>
                  <option value="">Seleccionar interés</option>
                  {snapshot.records
                    .filter((r) => r.type === 'interests' && r.status !== 'archived')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Hábito (opcional)
                <select value={habitId} onChange={(e) => setHabitId(e.target.value)}>
                  <option value="">Sin hábito</option>
                  {snapshot.records
                    .filter((r) => r.type === 'habits' && r.status === 'active')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Proyecto (opcional)
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">Sin proyecto</option>
                  {snapshot.records
                    .filter((r) => r.type === 'projects' && r.status !== 'archived')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Objetivo (opcional)
                <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                  <option value="">Sin objetivo</option>
                  {snapshot.records
                    .filter((r) => r.type === 'goals' && r.status === 'active')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Notas
                <textarea
                  maxLength={20000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Algo que quieras conservar de esta sesión"
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {!snapshot.records.some((r) => r.type === 'interests') && (
                <p>
                  Crea primero un <a href="/interests">interés</a>. El cronómetro se conserva en
                  este dispositivo.
                </p>
              )}
              <button className="button primary" disabled={saving}>
                <Save size={16} />
                {saving ? 'Guardando…' : 'Guardar sesión'}
              </button>
            </form>
          )}
          {timer.status !== 'idle' && (
            <button
              className="button subtle"
              onClick={() => {
                if (window.confirm('¿Descartar el tiempo del cronómetro sin guardarlo?')) {
                  update(freshTimer());
                  setFinishing(false);
                }
              }}
            >
              Descartar cronómetro
            </button>
          )}
          <p className="muted small">
            El borrador se conserva en este navegador. Las sesiones guardadas se sincronizan a
            través de la base de datos.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
