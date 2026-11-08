export interface TimerState {
  status: 'idle' | 'running' | 'paused';
  startedAt: string | null;
  runningSince: number | null;
  elapsedMs: number;
  idempotencyKey: string;
}
export function freshTimer(): TimerState {
  return {
    status: 'idle',
    startedAt: null,
    runningSince: null,
    elapsedMs: 0,
    idempotencyKey: crypto.randomUUID(),
  };
}
export function elapsedAt(timer: TimerState, now = Date.now()): number {
  return Math.max(
    0,
    timer.elapsedMs +
      (timer.status === 'running' && timer.runningSince !== null
        ? Math.max(0, now - timer.runningSince)
        : 0),
  );
}
export function startTimer(timer: TimerState, now = Date.now()): TimerState {
  if (timer.status === 'running') return timer;
  return {
    ...timer,
    status: 'running',
    startedAt: timer.startedAt ?? new Date(now).toISOString(),
    runningSince: now,
  };
}
export function pauseTimer(timer: TimerState, now = Date.now()): TimerState {
  if (timer.status !== 'running') return timer;
  return { ...timer, status: 'paused', elapsedMs: elapsedAt(timer, now), runningSince: null };
}
export function readTimer(value: string | null): TimerState | null {
  try {
    const timer: unknown = JSON.parse(value ?? 'null');
    if (!timer || typeof timer !== 'object') return null;
    const v = timer as Record<string, unknown>;
    if (
      !['idle', 'running', 'paused'].includes(String(v.status)) ||
      typeof v.elapsedMs !== 'number' ||
      !Number.isFinite(v.elapsedMs) ||
      v.elapsedMs < 0 ||
      typeof v.idempotencyKey !== 'string' ||
      v.idempotencyKey.length > 100
    )
      return null;
    if (
      v.startedAt !== null &&
      (typeof v.startedAt !== 'string' || !Number.isFinite(Date.parse(v.startedAt)))
    )
      return null;
    if (
      v.runningSince !== null &&
      (typeof v.runningSince !== 'number' || !Number.isFinite(v.runningSince))
    )
      return null;
    if (v.status === 'running' && v.runningSince === null) return null;
    return timer as TimerState;
  } catch {
    return null;
  }
}
export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}
