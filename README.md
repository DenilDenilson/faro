# FARO

Una perspectiva clara de los intereses, hábitos, proyectos y conocimientos que cultivas.
FARO registra actividad real y conserva memoria de tu evolución; no impone una agenda diaria.

## Funciones

- **Hoy:** actividad diaria/semanal, hábitos, proyectos, objetivos y recomendaciones calculadas.
- **Mi vida:** áreas ordenables, intereses con frecuencia propia y radar de atención.
- **Objetivos y proyectos:** indicadores medibles, avances explícitos, hitos e historial.
- **Hábitos y actividades:** frecuencias diaria/semanal/mensual/cada N días/días elegidos,
  cantidades o minutos, registro retrospectivo y cronómetro con pausa y recuperación.
- **Mi evolución:** distribución de tiempo, constancia, cumplimiento, comparaciones, heatmap,
  tendencias, cronología y revisión semanal editable.
- **Temporadas:** focos, mantenimiento y exploración con fechas e historial.
- **Aprendizajes:** notas, etiquetas, referencias y vínculos a intereses, sesiones y otras ideas.
- **Alertas:** centro interno configurable, descartes y posposición, sin correo ni push externo.
- **Datos:** respaldo JSON completo y restauración previsualizada sin duplicados ni borrados.
- **Privacidad:** contraseña única, sesión firmada y controles en todas las rutas y operaciones.

[Guía de uso](docs/user-guide.md) · [Fórmulas](docs/formulas.md) ·
[Arquitectura y convenciones](AGENTS.md) · [Respaldo y recuperación](docs/backups.md)

## Stack

Astro SSR y adaptador Vercel, islas React, TypeScript estricto, Tailwind CSS,
componentes shadcn/Radix, Lucide, Recharts, Zod, Drizzle ORM/Kit y libSQL/Turso.
Vitest, Playwright, ESLint y Prettier. Versiones compatibles fijadas en el lockfile.

## Requisitos e instalación

Node **24.x**, pnpm **11.25.0**, Git. Para E2E instalar Chromium con Playwright.

```sh
git clone https://github.com/DenilDenilson/faro.git
cd faro
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
openssl rand -hex 32
```

En `.env`, define una contraseña propia `FARO_PASSWORD` de al menos 12 caracteres y
`FARO_SESSION_SECRET` de al menos 32. El comando anterior genera un secreto aleatorio.
Nunca uses las credenciales fijas de las pruebas E2E para tu despliegue.

```sh
pnpm db:migrate
pnpm dev
```

Abre `http://localhost:4321`. Desarrollo usa el archivo SQLite indicado por
`TURSO_DATABASE_URL=file:./faro.db`; se crean únicamente las tablas `faro_`.
Sin contraseña o secreto adecuados, la aplicación permanece cerrada.
No se incluyen registros ficticios; empieza creando un área y un interés.

## Turso real

Crea una base Turso o utiliza una existente con permisos de escritura, y configura:

```dotenv
TURSO_DATABASE_URL=libsql://tu-base-tu-organizacion.turso.io
TURSO_AUTH_TOKEN=tu-token-privado
FARO_PASSWORD=tu-contrasena-personal
FARO_SESSION_SECRET=tu-secreto-aleatorio
```

No publiques este archivo. `.env.example` contiene solo nombres y valores de desarrollo.
El mismo cliente libSQL y las mismas migraciones sirven para SQLite local y Turso remoto.
Producción rechaza URLs de archivo y requiere URL remota y token; no crea silenciosamente
una base efímera en Vercel.

### Migraciones

```sh
pnpm db:migrate
pnpm db:generate
```

`db:migrate` aplica únicamente migraciones FARO ordenadas y aditivas, dentro de
transacciones mediante el migrador oficial de Drizzle, con seguimiento en `faro_migrations`. En producción ejecútalo **antes**
de desplegar, con las variables remotas configuradas. El servidor verifica versión y
no realiza sincronización destructiva del esquema. `db:generate` genera SQL/snapshots
con Drizzle Kit; revisa el SQL y actualiza `SCHEMA_VERSION` en
`src/db/migrations.ts`. No edites una migración aplicada ni uses `drizzle-kit push`.

Todas las tablas propias usan `faro_`, incluidas relaciones, preferencias, intentos de
acceso e historial. Las tablas de otras aplicaciones permanecen intactas. El modelo
usa documentos tipados por dominio dentro de `faro_records`, campos de consulta
indexados y relaciones normalizadas con claves foráneas en `faro_links`.

## Variables privadas

| Variable              | Uso                                                                 |
| --------------------- | ------------------------------------------------------------------- |
| `TURSO_DATABASE_URL`  | `file:` en desarrollo; `libsql://`/`https://` remota en producción. |
| `TURSO_AUTH_TOKEN`    | Token privado de Turso, obligatorio en producción.                  |
| `FARO_PASSWORD`       | Contraseña única de al menos 12 caracteres.                         |
| `FARO_SESSION_SECRET` | Clave de firma aleatoria de al menos 32 caracteres.                 |
| `FARO_DATABASE_PATH`  | Ruta SQLite de desarrollo cuando no se indica URL.                  |
| `CHROMIUM_PATH`       | Opcional: ejecutable Chromium local para E2E fuera de CI.           |

No hay credenciales Turso en JavaScript del navegador. Cambiar la contraseña o la clave
de firma revoca las sesiones anteriores. Cookies HttpOnly, SameSite Strict y Secure
bajo HTTPS/producción; sesión de siete días, acceso limitado por intentos persistidos.
Las mutaciones requieren `Origin` de la propia aplicación. No se incluyen registro,
recuperación de contraseña, OAuth ni perfiles multiusuario.

## Pruebas y calidad

```sh
pnpm check
pnpm lint
pnpm format:check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Vitest cubre reglas de frecuencia, pausas, temporadas, zona horaria, distribución sin
contabilización doble, revisiones, alertas, cronómetro, autenticación e integración con
libSQL real. Playwright verifica acceso privado, relaciones entre módulos, restauración,
uso desde dos dispositivos y pantallas móviles. Las pruebas crean su propia base local;
no necesitan ni modifican tu base Turso. CI ejecuta las mismas verificaciones.

Las dependencias de OXC/EMNAPI se fijan mediante `pnpm-workspace.yaml` porque algunas
versiones transitivas recientes son incompatibles entre sí. No elimines esas fijaciones
sin volver a verificar tipos, pruebas y build.

## Desplegar en Vercel

1. Importa este repositorio en Vercel. Framework: **Astro**, runtime Node **24.x**.
2. Añade las cuatro variables privadas de producción de la tabla anterior. Configúralas
   también para Preview si deseas probar contra una base separada.
3. Aplica `pnpm db:migrate` a Turso desde una terminal segura. Comprueba que usa la base
   correcta antes de ejecutar. Conserva un respaldo previo a cada cambio de esquema.
4. Vercel usa `pnpm install --frozen-lockfile` y `pnpm build`, según `vercel.json`.
5. Abre la URL HTTPS y comprueba el acceso con contraseña y la persistencia entre dispositivos.

No se publica en Sites: el destino solicitado es Vercel. El repositorio incluye el
adaptador y configuración de despliegue; crear/conectar el proyecto Vercel y aportar
credenciales Turso requiere acceso a esas cuentas. Sin ese acceso no se afirma un despliegue.
No se habilita una producción sin contraseña ni persistencia centralizada.

## Exportación y durabilidad

En **Configuración → Exportar todos mis datos**, descarga JSON con formato `faro`, versión 1,
registros, relaciones, preferencias e historial. Importar muestra registros nuevos,
duplicados y conflictos. La confirmación verifica el digest; no borra ni sobrescribe
registros existentes. Las preferencias solo se restauran al elegirlo expresamente.
El límite del importador web es 4 MB para respetar el límite de funciones de Vercel;
usa la herramienta CLI para respaldos mayores. Consulta [backups](docs/backups.md).

Mantén respaldos fuera de Turso, con retención y pruebas periódicas de restauración.
Los servicios remotos, su retención automática y sus planes comerciales pueden cambiar;
una base sincronizada no sustituye un respaldo independiente.

## Documentación de referencia

- [Astro y Vercel](https://docs.astro.build/en/guides/integrations-guide/vercel/)
- [Astro Actions](https://docs.astro.build/en/guides/actions/)
- [Drizzle con Turso](https://orm.drizzle.team/docs/connect-turso)
- [libSQL/Turso TypeScript](https://docs.turso.tech/sdk/ts/reference)
- [Vercel Functions: límites](https://vercel.com/docs/functions/limitations)
