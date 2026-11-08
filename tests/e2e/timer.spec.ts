import { test, expect } from '@playwright/test';
import type { FaroRecord, FaroSnapshot } from '../../src/lib/types';
const headers = { Origin: 'http://127.0.0.1:4322' };
test('cronómetro pausa, recarga y guarda una sola sesión', async ({ page, context }) => {
  const login = await context.request.post('/api/auth/login', {
    headers,
    data: { password: 'test-only-faro-password' },
  });
  expect(login.ok()).toBeTruthy();
  let state = (
    (await (await context.request.get('/api/snapshot')).json()) as { data: FaroSnapshot }
  ).data;
  let interest = state.records.find((r) => r.type === 'interests' && r.status === 'active');
  if (!interest) {
    const area = (
      (await (
        await context.request.post('/api/records', {
          headers,
          data: {
            type: 'areas',
            data: { name: 'Cronómetro área', description: '', status: 'active' },
          },
        })
      ).json()) as { data: FaroRecord }
    ).data;
    interest = (
      (await (
        await context.request.post('/api/records', {
          headers,
          data: {
            type: 'interests',
            data: {
              name: 'Cronómetro interés',
              description: '',
              status: 'active',
              areaId: area.id,
              frequencyDays: 7,
            },
          },
        })
      ).json()) as { data: FaroRecord }
    ).data;
  }
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Cronómetro', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Iniciar', exact: true }).click();
  await expect(dialog.getByRole('timer')).not.toHaveText('00:00:00');
  await dialog.getByRole('button', { name: 'Pausar', exact: true }).click();
  const paused = await dialog.getByRole('timer').textContent();
  await page.reload();
  await page.locator('.timer-trigger').click();
  await expect(page.getByRole('dialog').getByRole('timer')).toHaveText(paused ?? '');
  await page.getByRole('button', { name: 'Finalizar y registrar', exact: true }).click();
  await page.getByLabel('Actividad realizada', { exact: true }).fill('Sesión cronometrada E2E');
  await page.getByRole('combobox', { name: 'Interés', exact: true }).selectOption(interest.id);
  await page.getByRole('button', { name: 'Guardar sesión', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Sesión cronometrada E2E', { exact: true })).toBeVisible();
  state = ((await (await context.request.get('/api/snapshot')).json()) as { data: FaroSnapshot })
    .data;
  expect(state.records.filter((r) => r.name === 'Sesión cronometrada E2E')).toHaveLength(1);
  expect(
    state.records.find((r) => r.name === 'Sesión cronometrada E2E')?.durationMinutes,
  ).toBeGreaterThan(0);
});
