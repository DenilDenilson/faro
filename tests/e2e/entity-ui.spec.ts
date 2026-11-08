import { test, expect, type Page } from '@playwright/test';

async function loginThroughForm(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Contraseña de acceso').fill('test-only-faro-password');
  await page.getByRole('button', { name: /Entrar en FARO/ }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

function recordCard(page: Page, name: string) {
  return page
    .locator('.record-card')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
}

async function createArea(page: Page, name: string) {
  await page.goto('/areas');
  await page.getByRole('button', { name: 'Crear área', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Crear área', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/^Nombre/).fill(name);
  await dialog
    .getByLabel('Descripción', { exact: true })
    .fill('Área creada desde los formularios de FARO');
  await dialog.getByRole('button', { name: 'Crear área', exact: true }).click();
  await expect(recordCard(page, name)).toBeVisible();
}

test('los formularios guardan áreas, intereses, cambios de frecuencia y sesiones retrospectivas', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const suffix = `UI ${Date.now()}`;
  const areaName = `Conocimiento ${suffix}`;
  const interestName = `Historia ${suffix}`;
  const activityName = `Leer historia ${suffix}`;
  await loginThroughForm(page);
  await createArea(page, areaName);

  await page.goto('/interests');
  await page.getByRole('button', { name: 'Crear interés', exact: true }).first().click();
  let dialog = page.getByRole('dialog', { name: 'Crear interés', exact: true });
  await dialog.getByLabel(/^Nombre/).fill(interestName);
  await dialog.getByLabel(/^Área de vida/).selectOption({ label: areaName });
  await dialog.getByLabel(/^Atender cada cuántos días/).fill('7');
  await dialog.getByLabel('Prioridad', { exact: true }).selectOption('3');
  await dialog.getByRole('button', { name: 'Crear interés', exact: true }).click();
  await expect(recordCard(page, interestName)).toBeVisible();

  await recordCard(page, interestName)
    .getByRole('button', { name: `Editar ${interestName}`, exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Editar interés', exact: true });
  await dialog.getByLabel(/^Atender cada cuántos días/).fill('14');
  await dialog.getByLabel('Estado', { exact: true }).selectOption('paused');
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  const savedInterestDetail = page.getByRole('dialog', { name: interestName, exact: true });
  await expect(savedInterestDetail).toBeVisible();
  await expect(savedInterestDetail.locator('.badge').first()).toHaveText('En pausa');
  await savedInterestDetail.getByRole('button', { name: 'Cerrar diálogo' }).click();
  await expect(savedInterestDetail).not.toBeVisible();
  await expect(recordCard(page, interestName)).toContainText('Cada 14 días');
  await expect(recordCard(page, interestName).locator('.badge').first()).toHaveText('En pausa');

  await page.goto('/activities');
  await page.getByRole('button', { name: 'Crear actividad', exact: true }).first().click();
  dialog = page.getByRole('dialog', { name: 'Crear actividad', exact: true });
  await dialog.getByLabel(/^¿Qué hiciste/).fill(activityName);
  await dialog.getByLabel(/^Fecha y hora/).fill('2026-10-28T19:15');
  await dialog.getByLabel(/^Duración en minutos/).fill('45');
  await dialog.getByRole('checkbox', { name: interestName, exact: true }).check();
  await dialog
    .getByLabel('Notas', { exact: true })
    .fill('Registro retrospectivo verificado desde la interfaz.');
  await dialog.getByRole('button', { name: 'Crear actividad', exact: true }).click();
  await expect(recordCard(page, activityName)).toContainText('45 min');
  await recordCard(page, activityName)
    .getByRole('button', { name: activityName, exact: true })
    .click();
  const detail = page.getByRole('dialog', { name: activityName, exact: true });
  await expect(detail).toContainText('Registro retrospectivo verificado desde la interfaz.');
  await expect(
    detail.getByRole('button', { name: new RegExp(interestName) }).first(),
  ).toBeVisible();
  await detail.getByRole('button', { name: 'Cerrar diálogo' }).click();

  const response = await context.request.get('/api/snapshot');
  expect(response.ok()).toBeTruthy();
  const snapshot = (await response.json()).data as {
    records: Array<{
      id: string;
      name: string;
      occurredAt?: string;
      durationMinutes?: number;
      interestIds?: string[];
    }>;
    history: Array<{
      recordId: string;
      before?: { frequencyDays?: number };
      after?: { frequencyDays?: number; status?: string };
    }>;
  };
  const savedInterest = snapshot.records.find((item) => item.name === interestName)!;
  const savedActivity = snapshot.records.find((item) => item.name === activityName)!;
  expect(savedActivity.occurredAt).toBe('2026-10-29T00:15:00.000Z');
  expect(savedActivity.durationMinutes).toBe(45);
  expect(savedActivity.interestIds).toContain(savedInterest.id);
  expect(
    snapshot.history.some(
      (entry) =>
        entry.recordId === savedInterest.id &&
        entry.before?.frequencyDays === 7 &&
        entry.after?.frequencyDays === 14 &&
        entry.after.status === 'paused',
    ),
  ).toBeTruthy();
});

test('eliminar requiere confirmación y el formulario funciona en una pantalla móvil', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginThroughForm(page);
  const name = `Área temporal móvil ${Date.now()}`;
  await page.goto('/areas?new=1');
  const dialog = page.getByRole('dialog', { name: 'Crear área', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/^Nombre/)).toBeEditable();
  await dialog.getByLabel(/^Nombre/).fill(name);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
  await dialog.getByRole('button', { name: 'Crear área', exact: true }).click();
  await expect(recordCard(page, name)).toBeVisible();
  await recordCard(page, name)
    .getByRole('button', { name: `Eliminar ${name}`, exact: true })
    .click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText(name);
  await confirmation.getByRole('button', { name: 'Conservar', exact: true }).click();
  await expect(recordCard(page, name)).toBeVisible();
  await recordCard(page, name)
    .getByRole('button', { name: `Eliminar ${name}`, exact: true })
    .click();
  await confirmation.getByRole('button', { name: 'Sí, eliminar', exact: true }).click();
  await expect(recordCard(page, name)).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
});
