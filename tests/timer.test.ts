import { describe, expect, it } from 'vitest';
import {
  freshTimer,
  startTimer,
  pauseTimer,
  elapsedAt,
  readTimer,
  formatElapsed,
} from '../src/domains/activities/timer';
describe('cronómetro', () => {
  it('excluye pausas y conserva un identificador para reintentos', () => {
    const initial = freshTimer();
    const first = startTimer(initial, 1_000);
    const paused = pauseTimer(first, 61_000);
    expect(elapsedAt(paused, 999_000)).toBe(60_000);
    const resumed = startTimer(paused, 1_000_000);
    expect(elapsedAt(resumed, 1_030_000)).toBe(90_000);
    expect(resumed.idempotencyKey).toBe(initial.idempotencyKey);
    expect(resumed.startedAt).toBe(first.startedAt);
  });
  it('recupera una sesión tras recargar y rechaza borradores inválidos', () => {
    const running = startTimer(freshTimer(), 1_000);
    expect(elapsedAt(readTimer(JSON.stringify(running))!, 121_000)).toBe(120_000);
    expect(readTimer('{')).toBeNull();
    expect(readTimer(JSON.stringify({ ...running, elapsedMs: -1 }))).toBeNull();
    expect(readTimer(JSON.stringify({ ...running, runningSince: null }))).toBeNull();
    expect(formatElapsed(3_661_000)).toBe('01:01:01');
  });
});
