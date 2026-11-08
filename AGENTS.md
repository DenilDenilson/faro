# FARO — instrucciones de desarrollo

Aplicación personal de seguimiento de vida; SSR Astro con islas React, TypeScript estricto,
Tailwind, primitivas shadcn/Radix, Lucide y Recharts. Hosting Vercel; libSQL/Turso y Drizzle.

## Arquitectura

- `src/pages/`: páginas Astro SSR y endpoints JSON. Las páginas no forman una SPA.
- `src/layouts/`: navegación, tema y estructura responsive.
- `src/components/`: presentación e interacciones; formularios compartidos por dominio.
- `src/lib/types.ts` y `validation.ts`: contratos tipados y validación Zod.
- `src/lib/auth.ts`, `middleware.ts`, `src/actions/`: sesión privada y límites de acceso.
- `src/domains/<dominio>/`: servicios/repositorios y lógica pura de cada dominio.
- `src/db/`: esquema Drizzle, conexión y ejecutor de migraciones incrementales.
- `drizzle/`: SQL versionado y snapshots de Drizzle Kit.
- `tests/`: unidades/integración con libSQL real; `tests/e2e/`: Playwright.

## Reglas obligatorias

1. TODAS las tablas, índices y tablas de migración pertenecientes a FARO usan `faro_`.
   No modificar ni borrar tablas ajenas en bases Turso compartidas.
2. `faro_records` es un registro tipado por dominio. Las relaciones se normalizan en
   `faro_links`, con claves foráneas SQLite y validación del tipo de destino. Mantener
   juntos los campos indexados y el documento JSON validado, dentro de una transacción.
3. Añadir una migración nueva para cambios de esquema; nunca editar migraciones aplicadas
   ni usar `drizzle-kit push` contra producción. Drizzle Kit genera el SQL autoritativo;
   actualizar SCHEMA_VERSION en src/db/migrations.ts al añadir una migración. El migrador
   oficial conserva su seguimiento en faro_migrations; producción solo comprueba la versión.
4. Turso es fuente de verdad. SQLite local solo desarrollo/pruebas. Producción exige URL
   Turso remota y token. No exponer credenciales mediante variables `PUBLIC_*`.
5. Una actividad cuenta una vez en totales. Repartir su duración entre intereses al
   representar distribuciones; no sumar otra vez por sus hábitos/proyectos/objetivos.
6. Cada interés tiene frecuencia propia. Pausar no genera abandono. Conservar historial
   de frecuencia, prioridad, estado, temporadas y avances. Objetivos avanzan con medidas
   explícitas; proyectos mediante hitos/avances, nunca solo por horas.
7. Calcular fechas por zona IANA configurada (inicial America/Lima), semanas desde lunes,
   y guardar instantes ISO UTC. Evitar aritmética local del navegador para métricas.
8. Confirmar eliminaciones y restauraciones en la interfaz; proteger relaciones desde
   servidor. Favorecer archivar cuando un elemento tiene historial relacionado.
9. Toda operación requiere sesión privada; toda mutación requiere origen coincidente,
   validación de entrada y transacciones cuando modifica varias filas.
10. Exportaciones versionadas incluyen entidades, relaciones implícitas, preferencias e
    historial; importaciones previsualizadas no borran ni sobrescriben conflictos.
11. No añadir datos de ejemplo a producción ni gráficas ficticias. Distinguir vacío de cero.
12. El cronómetro local es solo borrador secundario. Guardar sesiones en servidor con
    clave de idempotencia; no usar IndexedDB/localStorage como base principal.

## Trabajo y validación

Usar Node 24 y pnpm según `packageManager`. No introducir Next.js, Prisma, PostgreSQL,
Express, Firebase, Supabase, Redis, Docker o servicios innecesarios.

Antes de publicar ejecutar `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test`,
`pnpm test:e2e`, `pnpm build`. Las pruebas deben verificar reglas y flujos significativos.
No incluir secretos, respaldos personales, `.env`, bases locales o reportes temporales en Git.
Subir cambios autorizados a `main` sin force push. Documentar límites externos de despliegue.
