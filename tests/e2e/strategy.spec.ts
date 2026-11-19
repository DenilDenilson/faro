import { test, expect, type APIRequestContext } from '@playwright/test';
import type { FaroRecord } from '../../src/lib/types';
import type { NorthView } from '../../src/domains/strategy';
import type { StrategyItem } from '../../src/domains/strategy/types';
const headers = { Origin: 'http://127.0.0.1:4322' };
async function login(request: APIRequestContext) {
  expect(
    (
      await request.post('/api/auth/login', {
        headers,
        data: { password: 'test-only-faro-password' },
      })
    ).ok(),
  ).toBeTruthy();
}
async function record(request: APIRequestContext, type: string, data: object): Promise<FaroRecord> {
  const r = await request.post('/api/records', {
    headers,
    data: { type, data: { description: '', status: 'active', ...data } },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).data;
}
async function strategy(request: APIRequestContext, data: object): Promise<StrategyItem> {
  const r = await request.post('/api/strategy', { headers, data: { data } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).data;
}
test('Mi norte conecta visión, claves, objetivos y aprendizajes y conserva cambios', async ({
  page,
  context,
}) => {
  await login(context.request);
  const area = await record(context.request, 'areas', { name: 'Rumbo personal E2E' });
  const interest = await record(context.request, 'interests', {
    name: 'Entrenamiento Rumbo E2E',
    areaId: area.id,
    frequencyDays: 4,
  });
  const goal = await record(context.request, 'goals', {
    name: 'Resultado Rumbo E2E',
    interestIds: [interest.id],
    priority: 3,
  });
  await page.goto('/north');
  await page.getByRole('button', { name: 'Crear visión', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre', { exact: true }).fill('Mi visión documentada E2E');
  await dialog.getByLabel('Cómo quiero vivir').fill('Con energía y espacio para aprender');
  await dialog.getByLabel('Por qué me importa').fill('Disfrutar de mis actividades');
  await dialog.getByLabel('Valores que quiero cultivar').fill('Curiosidad y autonomía');
  await dialog.getByRole('checkbox', { name: goal.name, exact: false }).check();
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Claves de poder', exact: true }).click();
  await page.getByRole('button', { name: 'Crear clave de poder', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre', { exact: true }).fill('Planificar entrenamiento E2E');
  await dialog.getByLabel('Qué quiero saber hacer').fill('Organizar una rutina y revisarla');
  await dialog.getByRole('combobox', { name: 'Etapa', exact: true }).selectOption('practicing');
  await dialog.getByRole('checkbox', { name: 'Mi visión documentada E2E', exact: true }).check();
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const initial = (await (await context.request.get('/api/strategy')).json()).data as NorthView;
  const vision = initial.items.find((i) => i.name === 'Mi visión documentada E2E')!;
  const key = initial.items.find((i) => i.name === 'Planificar entrenamiento E2E')!;
  await page.goto('/goals');
  await page.getByRole('button', { name: `Editar ${goal.name}`, exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: vision.name, exact: true }).check();
  await dialog.getByRole('checkbox', { name: key.name, exact: true }).check();
  await dialog.getByLabel('Por qué me importa').fill('Tener fuerza para mis actividades');
  await dialog.getByLabel('Acciones bajo mi influencia').fill('Organizar mis entrenamientos');
  await dialog.getByLabel('Alternativa ante obstáculos').fill('Ajustar el día de práctica');
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: vision.name, exact: true }),
  ).toBeVisible();
  await page.goto(`/learnings?new=1&interest=${interest.id}`);
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Título del descubrimiento *', { exact: true })
    .fill('Aprendizaje aplicado Rumbo E2E');
  await dialog
    .locator('summary')
    .filter({ hasText: 'Mi norte y capacidades relacionadas' })
    .click();
  await dialog.getByRole('checkbox', { name: key.name, exact: true }).check();
  await dialog.getByRole('button', { name: 'Crear aprendizaje', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Aprendizaje aplicado Rumbo E2E', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: key.name, exact: true }),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('link', { name: key.name, exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: /Aprendizaje aplicado Rumbo E2E/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Editar', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Etapa', exact: true }).selectOption('applied');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto(`/north?item=${vision.id}`);
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: vision.name, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Editar', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Por qué me importa').clear();
  await dialog.getByLabel('Cómo quiero vivir').fill('Mi visión revisada con intención');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const detail = (await (await context.request.get(`/api/strategy?id=${vision.id}`)).json())
    .data as { item: StrategyItem; history: { before: StrategyItem | null }[] };
  expect(detail.item.purpose ?? '').toBe('');
  expect(detail.history.some((h) => h.before?.purpose === 'Disfrutar de mis actividades')).toBe(
    true,
  );
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('las fuentes guardan cero y permiten revisar mediciones, referencias y rumbo', async ({
  page,
  context,
}) => {
  await login(context.request);
  await page.goto('/north');
  await page.getByRole('button', { name: 'Fuentes de poder', exact: true }).click();
  const money = page
    .locator('.north-resource-grid > section')
    .filter({ has: page.getByRole('heading', { name: 'Dinero', exact: true }) });
  await money.getByRole('button', { name: 'Añadir indicador', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre', { exact: true }).fill('Reserva personal Rumbo E2E');
  await dialog.getByLabel('Unidad', { exact: true }).fill('S/');
  await dialog.getByLabel('Mínimo personal (opcional)').fill('100');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  let indicator = money
    .locator('.north-indicator')
    .filter({ has: page.getByRole('button', { name: 'Reserva personal Rumbo E2E', exact: true }) });
  await expect(indicator.getByText('Sin mediciones', { exact: true })).toBeVisible();
  await indicator.getByRole('button', { name: 'Registrar medición', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Valor observado').fill('0');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(indicator.getByText('0 S/', { exact: true })).toBeVisible();
  await indicator.getByRole('button', { name: 'Reserva personal Rumbo E2E', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Editar', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Mínimo personal (opcional)').clear();
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  indicator = money
    .locator('.north-indicator')
    .filter({ has: page.getByRole('button', { name: 'Reserva personal Rumbo E2E', exact: true }) });
  await indicator.getByRole('button', { name: 'Ver mediciones', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('cell', { name: '0 S/', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Editar', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Valor observado')).toHaveValue('0');
  await dialog.getByLabel('Valor observado').fill('25');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('cell', { name: '25 S/', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar diálogo', exact: true }).click();
  await page.getByRole('button', { name: 'Revisión de rumbo', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva revisión de rumbo', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre', { exact: true }).fill('Revisión de rumbo documentada E2E');
  await dialog
    .getByLabel('Qué mantengo o ajusto de mi rumbo')
    .fill('Mantener el estudio y revisar su horario');
  await dialog
    .getByLabel('Cómo estoy cuidando cuerpo, dinero y tiempo')
    .fill('Reservar tiempo antes de aceptar más compromisos');
  await dialog.getByLabel('Decisiones', { exact: true }).fill('Revisar las prioridades');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Revisión de rumbo documentada E2E', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText('Mantener el estudio y revisar su horario', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('link', { name: 'Preparar la próxima semana', exact: true }),
  ).toHaveAttribute('href', /\/attention\?week=/);
});
test('los intereses se agrupan por área y el radar permite planificar proyectos y objetivos abiertos', async ({
  page,
  context,
}) => {
  await login(context.request);
  const a = await record(context.request, 'areas', { name: 'Área A Rumbo E2E', order: 0 });
  const b = await record(context.request, 'areas', { name: 'Área B Rumbo E2E', order: 1 });
  const interest = await record(context.request, 'interests', {
    name: 'Interés A grupo Rumbo E2E',
    areaId: a.id,
    frequencyDays: 7,
  });
  await record(context.request, 'interests', {
    name: 'Interés B grupo Rumbo E2E',
    areaId: b.id,
    frequencyDays: 7,
  });
  const vision = await strategy(context.request, {
    kind: 'vision',
    name: 'Visión del planificador E2E',
    description: 'Cultivar mis capacidades',
  });
  const goal = await record(context.request, 'goals', {
    name: 'Objetivo abierto planificador Rumbo E2E',
    interestIds: [interest.id],
    visionIds: [vision.id],
    purpose: 'Elegir en qué avanzar',
    priority: 3,
    targetValue: 10,
    currentValue: 1,
  });
  const project = await record(context.request, 'projects', {
    name: 'Proyecto abierto planificador Rumbo E2E',
    status: 'pending',
    interestIds: [interest.id],
    goalIds: [goal.id],
    priority: 3,
  });
  await record(context.request, 'milestones', {
    name: 'Hito concreto del planificador E2E',
    parentId: project.id,
    status: 'pending',
  });
  await page.goto('/interests?q=grupo+Rumbo+E2E');
  await expect(page.getByRole('heading', { name: a.name, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: b.name, exact: true })).toBeVisible();
  await page.goto('/attention');
  await page.getByLabel('Buscar objetivo o proyecto').fill('planificador Rumbo E2E');
  await expect(page.getByRole('link', { name: goal.name, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: project.name, exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: `Planificar acción para ${project.name}`, exact: true })
    .click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Qué quiero hacer')).toHaveValue(
    'Trabajar en Hito concreto del planificador E2E',
  );
  await dialog
    .getByRole('combobox', { name: 'Día', exact: true })
    .selectOption({ label: 'Miércoles' });
  await dialog.getByRole('button', { name: 'Guardar tarea', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('button', { name: /Previsto Trabajar en Hito concreto del planificador E2E/ })
    .click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: vision.name, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar diálogo', exact: true }).click();
  const state = (await (await context.request.get(`/api/records/${project.id}`)).json())
    .data as FaroRecord;
  expect(state.status).toBe('pending');
  const goalState = (await (await context.request.get(`/api/records/${goal.id}`)).json())
    .data as FaroRecord;
  expect(goalState.currentValue).toBe(1);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
