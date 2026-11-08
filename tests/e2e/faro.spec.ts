import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type {
  FaroRecord,
  FaroSnapshot,
  FaroBackup,
  EntityType,
  RecordInput,
  ImportPreview,
} from '../../src/lib/types';
const origin = 'http://127.0.0.1:4322';
const headers = { Origin: origin };
async function login(request: APIRequestContext) {
  const response = await request.post('/api/auth/login', {
    headers,
    data: { password: 'test-only-faro-password' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}
async function create(
  request: APIRequestContext,
  type: EntityType,
  data: Partial<RecordInput> & { name: string },
): Promise<FaroRecord> {
  const response = await request.post('/api/records', {
    headers,
    data: { type, data: { description: '', status: 'active', ...data } },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { data: FaroRecord }).data;
}
async function snapshot(request: APIRequestContext): Promise<FaroSnapshot> {
  const response = await request.get('/api/snapshot');
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { data: FaroSnapshot }).data;
}
async function pageReady(page: Page) {
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Internal Server Error');
}

test('el acceso privado exige sesión y rechaza solicitudes de otro origen', async ({
  request,
  page,
}) => {
  const blocked = await request.get('/api/snapshot');
  expect(blocked.status()).toBe(401);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  const bad = await request.post('/api/auth/login', { headers, data: { password: 'incorrecta' } });
  expect(bad.status()).toBe(401);
  await login(request);
  const cross = await request.post('/api/records', {
    headers: { Origin: 'https://example.invalid' },
    data: { type: 'areas', data: { name: 'No autorizado' } },
  });
  expect(cross.status()).toBe(403);
  const missing = await request.post('/api/records', {
    data: { type: 'areas', data: { name: 'Sin origen' } },
  });
  expect(missing.status()).toBe(403);
  const invalid = await request.post('/api/records', {
    headers,
    data: { type: 'activities', data: { name: 'Inválida', durationMinutes: -3 } },
  });
  expect(invalid.status()).toBe(400);
});

test('los quince módulos comparten datos reales y mantienen relaciones e historial', async ({
  page,
  context,
}) => {
  await login(context.request);
  const area = await create(context.request, 'areas', {
    name: 'Tecnología E2E',
    color: '#1b6054',
    icon: 'Cpu',
    order: 0,
  });
  const interest = await create(context.request, 'interests', {
    name: 'Robótica E2E',
    areaId: area.id,
    priority: 3,
    frequencyDays: 7,
  });
  const goal = await create(context.request, 'goals', {
    name: 'Construir agente E2E',
    interestIds: [interest.id],
    targetValue: 5,
    currentValue: 1,
    unit: 'experimentos',
    outcomes: 'Cinco experimentos reproducibles',
  });
  const habit = await create(context.request, 'habits', {
    name: 'Estudiar robótica E2E',
    interestIds: [interest.id],
    goalIds: [goal.id],
    cadence: 'weekly',
    targetCount: 2,
  });
  const project = await create(context.request, 'projects', {
    name: 'Robot evasor E2E',
    areaId: area.id,
    interestIds: [interest.id],
    goalIds: [goal.id],
    status: 'in_progress',
    priority: 3,
  });
  await create(context.request, 'milestones', {
    name: 'Primer sensor E2E',
    parentId: project.id,
    status: 'completed',
  });
  await create(context.request, 'progress', {
    name: 'Experimento completo E2E',
    parentId: goal.id,
    value: 2,
    occurredAt: new Date().toISOString(),
  });
  const activity = await create(context.request, 'activities', {
    name: 'Entrenar agente E2E',
    interestIds: [interest.id],
    habitIds: [habit.id],
    goalIds: [goal.id],
    projectIds: [project.id],
    durationMinutes: 90,
    occurredAt: new Date().toISOString(),
    idempotencyKey: 'e2e-unique-session-001',
  });
  const duplicate = await create(context.request, 'activities', {
    name: 'Entrenar agente E2E',
    interestIds: [interest.id],
    habitIds: [habit.id],
    goalIds: [goal.id],
    projectIds: [project.id],
    durationMinutes: 90,
    occurredAt: activity.occurredAt,
    idempotencyKey: 'e2e-unique-session-001',
  });
  expect(duplicate.id).toBe(activity.id);
  const learning = await create(context.request, 'learnings', {
    name: 'Aprendizaje por refuerzo E2E',
    interestIds: [interest.id],
    activityId: activity.id,
    tags: ['robótica'],
    references: ['https://docs.astro.build/'],
    occurredAt: new Date().toISOString(),
  });
  await create(context.request, 'learnings', {
    name: 'LiDAR E2E',
    interestIds: [interest.id],
    learningIds: [learning.id],
  });
  const today = new Date().toISOString().slice(0, 10);
  await create(context.request, 'seasons', {
    name: 'Maestría E2E',
    startDate: today,
    endDate: today,
    focusIds: [interest.id, goal.id],
    maintenanceIds: [area.id],
    explorationIds: [project.id],
  });
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  await create(context.request, 'reviews', {
    name: 'Revisión E2E',
    weekStart: monday.toISOString().slice(0, 10),
    reflections: 'Una buena semana',
    achievements: 'Robot entrenado',
    difficulties: 'Datos escasos',
    decisions: 'Medir resultados',
    nextPriorities: 'Inglés',
  });
  const updated = await context.request.put(`/api/records/${interest.id}`, {
    headers,
    data: {
      type: 'interests',
      data: {
        name: interest.name,
        description: 'Nueva prioridad',
        status: 'paused',
        areaId: area.id,
        frequencyDays: 14,
        priority: 2,
      },
    },
  });
  expect(updated.ok(), await updated.text()).toBeTruthy();
  const data = await snapshot(context.request);
  expect(
    data.records.filter(
      (r) => r.type === 'activities' && r.idempotencyKey === 'e2e-unique-session-001',
    ),
  ).toHaveLength(1);
  expect(
    data.history.some(
      (h) =>
        h.recordId === interest.id && h.operation === 'update' && h.before?.frequencyDays === 7,
    ),
  ).toBeTruthy();
  for (const route of [
    '/',
    '/areas',
    '/interests',
    '/goals',
    '/habits',
    '/projects',
    '/activities',
    '/attention',
    '/analytics',
    '/reviews',
    '/seasons',
    '/alerts',
    '/timeline',
    '/learnings',
    '/settings',
  ]) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await pageReady(page);
  }
  await page.goto('/analytics');
  await expect(
    page.locator('.chart-legend').getByText('Tecnología E2E', { exact: false }).first(),
  ).toBeVisible();
  const linkedDelete = await context.request.delete(`/api/records/${area.id}`, { headers });
  expect(linkedDelete.status()).toBe(409);
  const disposable = await create(context.request, 'areas', { name: 'Temporal E2E' });
  const removed = await context.request.delete(`/api/records/${disposable.id}`, { headers });
  expect(removed.ok(), await removed.text()).toBeTruthy();
  expect((await snapshot(context.request)).records.some((r) => r.id === disposable.id)).toBeFalsy();
});

test('el respaldo valida, previsualiza, restaura sin duplicar y detecta cambios', async ({
  context,
}) => {
  await login(context.request);
  const exported = await context.request.get('/api/data/export');
  expect(exported.ok(), await exported.text()).toBeTruthy();
  const backup = (await exported.json()) as FaroBackup;
  expect(backup.format).toBe('faro');
  expect(backup.version).toBe(1);
  const first = await context.request.post('/api/data/import', {
    headers,
    data: { mode: 'preview', data: backup },
  });
  expect(first.ok(), await first.text()).toBeTruthy();
  const inspection = (
    (await first.json()) as { data: { preview: ImportPreview; previewToken: string } }
  ).data;
  expect(inspection.preview.newRecords).toBe(0);
  expect(inspection.preview.duplicates).toBe(backup.records.length);
  const countBefore = (await snapshot(context.request)).records.length;
  const restored = await context.request.post('/api/data/import', {
    headers,
    data: {
      mode: 'confirm',
      data: backup,
      previewToken: inspection.previewToken,
      restoreSettings: false,
    },
  });
  expect(restored.ok(), await restored.text()).toBeTruthy();
  expect((await snapshot(context.request)).records).toHaveLength(countBefore);
  const broken = await context.request.post('/api/data/import', {
    headers,
    data: { mode: 'preview', data: { ...backup, version: 999 } },
  });
  expect(broken.status()).toBe(400);
});

test('dos dispositivos consultan la misma persistencia y las preferencias se conservan', async ({
  browser,
  context,
  page,
}) => {
  await login(context.request);
  const updated = await context.request.put('/api/settings', {
    headers,
    data: { theme: 'dark', timezone: 'America/Lima' },
  });
  expect(updated.ok(), await updated.text()).toBeTruthy();
  const other = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  await login(other.request);
  const otherData = await snapshot(other.request);
  expect(otherData.settings.theme).toBe('dark');
  expect(otherData.records.some((r) => r.name === 'Robótica E2E')).toBeTruthy();
  await page.goto('/settings');
  await pageReady(page);
  const phone = await other.newPage();
  await phone.goto('/');
  await pageReady(phone);
  expect(
    await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
  await phone.goto('/activities');
  await pageReady(phone);
  expect(
    await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
  await other.close();
});

test('los filtros históricos, el calendario y las alertas usan los servicios del servidor', async ({
  context,
  page,
}) => {
  await login(context.request);
  const data = await snapshot(context.request);
  const habit = data.records.find((record) => record.type === 'habits')!;
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const first = `${day.slice(0, 7)}-01`;
  const calendar = await context.request.get(
    `/api/habits/${habit.id}/history?from=${first}&to=${day}`,
  );
  expect(calendar.ok(), await calendar.text()).toBeTruthy();
  expect((await calendar.json()).data.calendar.length).toBe(Number(day.slice(-2)));
  const summary = await context.request.get('/api/reviews/summary');
  expect(summary.ok(), await summary.text()).toBeTruthy();
  expect((await summary.json()).data.summary.activityCount).toBeGreaterThan(0);
  const stats = await context.request.get('/api/analytics?all=1');
  expect(stats.ok(), await stats.text()).toBeTruthy();
  const expected = data.records
    .filter(
      (record) =>
        record.type === 'activities' &&
        record.status !== 'cancelled' &&
        record.occurredAt! <= new Date().toISOString(),
    )
    .reduce((sum, record) => sum + (record.durationMinutes ?? 0), 0);
  expect((await stats.json()).data.totalMinutes).toBeCloseTo(expected);
  const timeline = await context.request.get('/api/timeline?type=activities&limit=1');
  expect(timeline.ok(), await timeline.text()).toBeTruthy();
  expect((await timeline.json()).data.events).toHaveLength(1);
  await page.goto('/analytics');
  await expect(page.locator('astro-island[component-url*="Analytics"][ssr]')).toHaveCount(0);
  const filtered = page.waitForResponse(
    (response) => response.url().includes('/api/analytics?') && response.status() === 200,
  );
  await page.getByRole('combobox', { name: 'Período', exact: true }).selectOption('all');
  await filtered;
  await expect(page.getByText('Entrenar agente E2E', { exact: true })).toHaveCount(0);
  await page.goto('/habits');
  await expect(page.locator('astro-island[component-url*="EntityManager"][ssr]')).toHaveCount(0);
  await page.getByRole('button', { name: habit.name, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Mes del historial del hábito', { exact: true })).toBeVisible();
  const alertResponse = await context.request.get('/api/notifications');
  expect(alertResponse.ok()).toBeTruthy();
  const alerts = (await alertResponse.json()).data as { id: string }[];
  if (alerts.length) {
    const dismissed = await context.request.post('/api/notifications', {
      headers,
      data: { id: alerts[0].id, action: 'dismiss' },
    });
    expect(dismissed.ok(), await dismissed.text()).toBeTruthy();
    const remaining = (await (await context.request.get('/api/notifications')).json()).data as {
      id: string;
    }[];
    expect(remaining.some((alert) => alert.id === alerts[0].id)).toBeFalsy();
  }
});
