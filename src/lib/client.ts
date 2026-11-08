/** Browser transport. Credentials stay in HttpOnly cookies, never JavaScript storage. */
export async function apiRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as {
    ok?: boolean;
    data?: T;
    error?: string;
  } | null;
  if (!response.ok || !result?.ok) {
    if (response.status === 401)
      throw new Error('Tu sesión ha terminado. Vuelve a ingresar para guardar los cambios.');
    throw new Error(result?.error ?? 'No pudimos completar la operación. Inténtalo de nuevo.');
  }
  return result.data as T;
}

export function localDateTime(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Resolve a wall-clock input in the selected IANA zone, including DST offsets. */
export function zonedInputToIso(input: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input))
    throw new Error('Introduce una fecha y hora válida.');
  const wanted = new Date(`${input}:00Z`).getTime();
  let instant = wanted;
  for (let index = 0; index < 4; index += 1) {
    const shown = localDateTime(new Date(instant).toISOString(), timezone);
    const shownAsUtc = new Date(`${shown}:00Z`).getTime();
    const delta = wanted - shownAsUtc;
    if (delta === 0) return new Date(instant).toISOString();
    instant += delta;
  }
  throw new Error('Esa hora no existe en la zona horaria elegida. Selecciona otra hora.');
}

export function formatMinutes(minutes: number): string {
  if (minutes > 0 && minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} s`;
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  return `${Math.floor(rounded / 60)} h${rounded % 60 ? ` ${rounded % 60} min` : ''}`;
}

export function formatDate(
  value: string | undefined,
  timezone: string,
  includeTime = false,
): string {
  if (!value) return 'Sin fecha';
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: value.length === 10 ? 'UTC' : timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}
