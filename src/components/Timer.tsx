import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Timer as TimerIcon, Play, Pause, X, Save } from 'lucide-react';
import type { WeekPlan } from '../domains/planning/types';
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
  useEffect(() => {
    if (timer.plan) {
      setName(timer.plan.name);
      setInterestId(timer.plan.interestId);
      setHabitId(timer.plan.habitId ?? '');
      setProjectId(timer.plan.projectId ?? '');
      setGoalId(timer.plan.goalId ?? '');
      setNotes(timer.plan.notes ?? '');
    }
  }, [timer.plan]);
  useEffect(() => {
    const fromPlan = (event: Event) => {
      const plan = (event as CustomEvent<WeekPlan>).detail;
      if (!plan || plan.kind !== 'plan' || plan.status !== 'pending' || !plan.interestIds.length)
        return;
      setOpen(true);
      setError('');
      if (timer.status !== 'idle' && timer.plan?.id !== plan.id) {
        setError(
          'Ya tienes un cronómetro en curso. Guarda o descarta esa sesión antes de iniciar otra práctica.',
        );
        return;
      }
      setFinishing(false);
      if (timer.status === 'idle')
        update(
          startTimer({
            ...freshTimer(),
            plan: {
              id: plan.id,
              name: plan.name,
              weekStart: plan.weekStart,
              interestId: plan.interestIds[0]!,
              habitId: plan.habitIds?.[0],
              projectId: plan.projectIds?.[0],
              goalId: plan.goalIds?.[0],
              notes: plan.notes,
            },
          }),
        );
      else update(startTimer(timer));
    };
    window.addEventListener('faro:plan-timer', fromPlan);
    return () => window.removeEventListener('faro:plan-timer', fromPlan);
  }, [timer]);
  useEffect(() => {
    if (ready) window.dispatchEvent(new Event('faro:timer-ready'));
  }, [ready]);
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
      const response = await fetch(timer.plan ? '/api/planning' : '/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          timer.plan
            ? {
                action: 'complete',
                id: timer.plan.id,
                name,
                occurredAt: timer.startedAt,
                durationMinutes,
                notes,
              }
            : {
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
              },
        ),
      });
      const result = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !result.ok)
        throw new Error(
          result.error ?? 'No se pudo guardar la actividad. Tu cronómetro sigue disponible.',
        );
      const cleared = freshTimer();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleared));
      setTimer(cleared);
      window.location.assign(
        timer.plan ? `/attention?week=${timer.plan.weekStart}` : '/activities',
      );
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
          {timer.plan && (
            <p className="muted small">
              Práctica: {timer.plan.name}. Sus vínculos se conservarán al guardar.
            </p>
          )}
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
                <select
                  disabled={Boolean(timer.plan)}
                  value={interestId}
                  required
                  onChange={(e) => setInterestId(e.target.value)}
                >
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
                <select
                  disabled={Boolean(timer.plan)}
                  value={habitId}
                  onChange={(e) => setHabitId(e.target.value)}
                >
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
                <select
                  disabled={Boolean(timer.plan)}
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
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
                <select
                  disabled={Boolean(timer.plan)}
                  value={goalId}
                  onChange={(e) => setGoalId(e.target.value)}
                >
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
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
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
