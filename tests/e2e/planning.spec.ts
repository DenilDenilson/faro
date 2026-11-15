import { test, expect, type APIRequestContext } from '@playwright/test';
import { addDays, dateKey, startOfWeek } from '../../src/domains/analytics/dates';
import type { FaroRecord, FaroSnapshot } from '../../src/lib/types';
import type { PlanningView } from '../../src/domains/planning';
const headers = { Origin: 'http://127.0.0.1:4322' };
async function setup(request: APIRequestContext, label: string) {
  const login = await request.post('/api/auth/login', {
    headers,
    data: { password: 'test-only-faro-password' },
  });
  expect(login.ok()).toBeTruthy();
  async function create(type: string, data: object) {
    const response = await request.post('/api/records', {
      headers,
      data: { type, data: { description: '', status: 'active', ...data } },
    });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()).data as FaroRecord;
  }
  const area = await create('areas', { name: `Área semanal ${label}` });
  const interest = await create('interests', {
    name: `Guitarra semanal ${label}`,
    areaId: area.id,
    frequencyDays: 7,
  });
  const habit = await create('habits', {
    name: `Practicar guitarra ${label}`,
    interestIds: [interest.id],
    cadence: 'weekly',
    targetCount: 3,
  });
  const project = await create('projects', {
    name: `Primera canción ${label}`,
    interestIds: [interest.id],
  });
  const response = await request.get('/api/snapshot');
  const snapshot = (await response.json()).data as FaroSnapshot;
  const week = startOfWeek(dateKey(snapshot.generatedAt, snapshot.settings.timezone));
  return { area, interest, habit, project, week };
}
test('el radar guarda intenciones, permite moverlas y registra una sesión real con sus vínculos', async ({
  page,
  context,
}) => {
  const { interest, habit, project, week } = await setup(context.request, 'manual');
  await page.goto(`/attention?week=${week}`);
  await page.getByRole('button', { name: 'Nueva práctica', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Qué quiero hacer').fill('Practicar el riff semanal');
  await dialog.getByRole('combobox', { name: 'Interés', exact: true }).selectOption(interest.id);
  await dialog
    .getByRole('combobox', { name: 'Hábito (opcional)', exact: true })
    .selectOption(habit.id);
  await dialog
    .getByRole('combobox', { name: 'Proyecto (opcional)', exact: true })
    .selectOption(project.id);
  await dialog.getByRole('combobox', { name: 'Día', exact: true }).selectOption(addDays(week, 1));
  await dialog.getByLabel('Minutos estimados (opcional)').fill('40');
  await dialog.getByLabel('Notas para la práctica').fill('Trabajar el cambio de cuerdas');
  await dialog.getByRole('button', { name: 'Guardar práctica', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  let planned = page.getByRole('button', { name: /Previsto Practicar el riff semanal/ });
  await expect(planned).toBeVisible();
  await expect(planned).toBeEnabled();
  await planned.dragTo(page.getByRole('region', { name: 'Viernes', exact: true }), {
    sourcePosition: { x: 8, y: 8 },
    targetPosition: { x: 20, y: 20 },
  });
  await expect(
    page
      .getByRole('region', { name: 'Viernes', exact: true })
      .getByRole('button', { name: /Practicar el riff semanal/ }),
  ).toBeVisible();
  await planned.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Editar práctica' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Minutos estimados (opcional)').clear();
  await dialog.getByRole('combobox', { name: 'Día', exact: true }).selectOption('');
  await dialog.getByRole('button', { name: 'Guardar práctica', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page
    .getByRole('button', { name: 'Practicar el riff semanal Sin duración estimada · Elegir día' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Mover a', exact: true })
    .selectOption(addDays(week, 2));
  await expect(page.getByRole('dialog')).not.toBeVisible();
  planned = page.getByRole('button', { name: /Previsto Practicar el riff semanal/ });
  await planned.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Registrar sesión', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Minutos reales').fill('23');
  await dialog.getByRole('button', { name: 'Guardar sesión', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('link', { name: /Realizado Practicar el riff semanal/ }),
  ).toBeVisible();
  const response = await context.request.get(`/api/planning?week=${week}`);
  const view = (await response.json()).data as PlanningView;
  const activity = view.activities.find((a) => a.name === 'Practicar el riff semanal');
  expect(activity).toMatchObject({
    habitIds: [habit.id],
    interestIds: [interest.id],
    projectIds: [project.id],
    durationMinutes: 23,
  });
  expect(view.rhythms.find((r) => r.habit.id === habit.id)?.done).toBe(1);
  expect(
    view.plans.find((p) => p.name === 'Practicar el riff semanal')?.estimatedMinutes,
  ).toBeUndefined();
  const reviewSnapshot = (await (await context.request.get('/api/snapshot')).json())
    .data as FaroSnapshot;
  const existingReview = reviewSnapshot.records.find(
    (r) => r.type === 'reviews' && r.weekStart === week,
  );
  const reviewResponse = await context.request.fetch(
    existingReview ? `/api/records/${existingReview.id}` : '/api/records',
    {
      method: existingReview ? 'PUT' : 'POST',
      headers,
      data: {
        type: 'reviews',
        data: {
          name: 'Revisión semanal de guitarra',
          description: '',
          status: 'active',
          weekStart: week,
          reflections: (
            (existingReview?.reflections ?? '') +
            '\nConservar estas notas al preparar la semana siguiente'
          ).trim(),
        },
      },
    },
  );
  expect(reviewResponse.ok(), await reviewResponse.text()).toBeTruthy();
  const review = (await reviewResponse.json()).data as FaroRecord;
  await page.reload();
  await page.getByRole('button', { name: 'Cerrar semana', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'Abrir revisión de esta semana' }),
  ).toHaveAttribute('href', `/reviews?id=${review.id}`);
  await page
    .getByRole('dialog')
    .getByRole('link', { name: 'Abrir revisión de esta semana' })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .getByText('Conservar estas notas al preparar la semana siguiente', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'Preparar la próxima semana' }),
  ).toHaveAttribute('href', `/attention?week=${addDays(week, 7)}`);
  await page.goto(`/attention?week=${week}`);
  await page.getByRole('button', { name: 'Semanas tipo', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre de la semana tipo').fill('Rutina guitarra E2E');
  await dialog.getByRole('button', { name: 'Guardar distribución de esta semana' }).click();
  await expect(dialog.getByText('Rutina guitarra E2E', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar diálogo' }).click();
  await page.goto(`/attention?week=${addDays(week, 7)}`);
  await page.getByRole('button', { name: 'Semanas tipo', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: /Previsto Practicar el riff semanal/ }),
  ).toBeVisible();
  const future = await context.request.get(`/api/planning?week=${addDays(week, 7)}`);
  const next = (await future.json()).data as PlanningView;
  expect(next.activities).toHaveLength(0);
  expect(next.plans.filter((p) => p.name === 'Practicar el riff semanal')).toHaveLength(1);
  await page.getByRole('button', { name: 'Cerrar semana', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'Abrir revisión de esta semana' }),
  ).toHaveAttribute('href', `/reviews?week=${addDays(week, 7)}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar diálogo' }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('el cronómetro conserva la práctica tras recargar y guarda una única sesión', async ({
  page,
  context,
}) => {
  const { interest, habit, week } = await setup(context.request, 'timer');
  const created = await context.request.post('/api/planning', {
    headers,
    data: {
      action: 'save',
      data: {
        name: 'Escalas con cronómetro E2E',
        weekStart: week,
        interestIds: [interest.id],
        habitIds: [habit.id],
      },
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/attention?week=${week}`);
  await page
    .getByRole('button', { name: 'Escalas con cronómetro E2E Sin duración estimada · Elegir día' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Iniciar cronómetro', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Cronómetro', exact: true })).toBeVisible();
  await page.reload();
  await page.locator('.timer-trigger').click();
  const timer = page.getByRole('dialog', { name: 'Cronómetro', exact: true });
  await expect(
    timer.getByText('Práctica: Escalas con cronómetro E2E.', { exact: false }),
  ).toBeVisible();
  // A real second verifies persisted elapsed time without changing the server clock.
  await page.waitForTimeout(1100);
  await timer.getByRole('button', { name: 'Finalizar y registrar' }).click();
  await expect(timer.getByLabel('Actividad realizada')).toHaveValue('Escalas con cronómetro E2E');
  await expect(timer.getByRole('combobox', { name: 'Interés', exact: true })).toHaveValue(
    interest.id,
  );
  await timer.getByRole('button', { name: 'Guardar sesión', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/attention\\?week=' + week));
  await expect(
    page.getByRole('link', { name: /Realizado Escalas con cronómetro E2E/ }),
  ).toBeVisible();
  const response = await context.request.get(`/api/planning?week=${week}`);
  const view = (await response.json()).data as PlanningView;
  expect(view.activities.filter((a) => a.name === 'Escalas con cronómetro E2E')).toHaveLength(1);
  expect(view.rhythms.find((r) => r.habit.id === habit.id)?.done).toBe(1);
});
