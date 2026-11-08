# Respaldos, retención y recuperación

Turso centraliza los datos entre dispositivos. Una base remota por sí sola no protege frente a borrados, errores humanos, pérdida de una cuenta o cambios incorrectos. FARO combina exportaciones portables con las herramientas de recuperación que ofrezca el plan de Turso.

## Qué contiene un respaldo

El JSON de FARO tiene `format: "faro"` y `version: 1`. Incluye todos los registros, sus IDs y relaciones, preferencias y el historial de cambios, incluidos registros eliminados del historial. Las relaciones actuales se reconstruyen y validan al restaurar. La exportación usa una lectura transaccional consistente.

El archivo no contiene la contraseña de acceso, la clave de sesión ni el token de Turso. Tampoco contiene datos de aplicaciones que compartan la misma base. Aun así, contiene información personal sensible: guárdalo cifrado y con acceso privado. Los archivos creados por la CLI tienen permisos `0600` en sistemas que admitan permisos POSIX.

La interfaz permite descargar un respaldo y previsualizar una importación. Para archivos grandes utiliza la CLI: las funciones de Vercel tienen un límite de carga y respuesta de aproximadamente 4,5 MB, y FARO limita la carga de la interfaz a 4 MiB. La CLI conecta directamente a Turso/libSQL y evita ese límite HTTP. La validación se mantiene: hasta 250 000 registros actuales y 1 000 000 de entradas de historial por archivo, con memoria suficiente en el equipo que ejecute Node.

## Configuración de la CLI

Instala las dependencias con `pnpm install --frozen-lockfile`. Configura `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` en variables privadas o en un `.env` local excluido de Git. No escribas tokens en comandos, archivos de respaldo ni documentos. Para operaciones remotas utiliza `NODE_ENV=production`, de modo que se rechace una URL local o una conexión sin token.

Aplica previamente las migraciones con `pnpm db:migrate`. Los comandos de datos comprueban el esquema y nunca crean o alteran tablas implícitamente. Todas las tablas que utiliza FARO empiezan por `faro_`.

## Exportar y comprobar

```sh
pnpm db:export work/backups/faro-2026-11-07.json
pnpm exec tsx scripts/data.ts preview work/backups/faro-2026-11-07.json
```

`export` publica el archivo completo y no reemplaza un destino existente. Informa el número de registros, entradas de historial y SHA-256 del archivo. Conserva el hash junto a tu registro de respaldos; permite detectar alteraciones al transferirlo. `preview` valida el formato y las relaciones y muestra las diferencias respecto de la base conectada sin cambiarla.

Usa un nombre distinto en cada ejecución. `work/` está excluido de Git y resulta adecuado para archivos locales temporales; no es por sí mismo un almacenamiento externo ni permanente.

## Restaurar con confirmación

1. Conserva un respaldo adicional del destino antes de restaurar. Para recuperar un estado anterior completo, prepara una base Turso nueva y vacía: así no sobrescribes los datos actuales ni tablas de otras aplicaciones.
2. Conecta la CLI al destino elegido mediante sus variables privadas y ejecuta `pnpm db:migrate`.
3. Ejecuta la previsualización sobre ese destino:

   ```sh
   pnpm exec tsx scripts/data.ts preview work/backups/faro-2026-11-07.json
   ```

4. Revisa `newRecords`, `duplicates`, `conflicts`, `byType` y `warnings`. Copia el valor `digest` que se muestra; corresponde a ese archivo y al estado actual de la base.
5. Confirma con ese digest. Los signos `<...>` representan el valor obtenido, no deben escribirse literalmente:

   ```sh
   pnpm db:import work/backups/faro-2026-11-07.json --digest <digest-de-64-caracteres>
   ```

   Añade `--restore-settings` solo si también quieres reemplazar las preferencias actuales por las del respaldo. Sin esa opción se conservan las preferencias del destino.

6. Si el archivo o los registros del destino cambiaron entre la vista previa y la confirmación, FARO rechaza la importación. Ejecuta una nueva previsualización antes de volver a confirmar.
7. Comprueba los conteos y abre áreas, intereses, sesiones, hábitos, proyectos y revisiones. Exporta de nuevo el destino y prueba una segunda previsualización: los registros restaurados deben aparecer como duplicados, sin incorporarse dos veces.

La importación añade únicamente IDs nuevos. Los registros existentes iguales se omiten; los que comparten ID y difieren también se conservan sin modificaciones. No elimina tablas, no borra registros y no aplica un reemplazo destructivo. Las inserciones y relaciones se confirman en una sola transacción; cualquier validación o restricción fallida revierte la operación. Un respaldo con una sesión repetida bajo un ID diferente puede ser rechazado por la restricción de duplicados de sesiones.

Para recuperar una versión anterior de un registro existente, restaura en una base vacía y revisa el resultado antes de cambiar la conexión del despliegue. La importación combinada protege el destino actual y no deshace cambios recientes.

## Política periódica recomendada

Una política inicial razonable es una exportación diaria, conservación de 30 copias diarias, 12 semanales y 12 mensuales. Conserva al menos una copia cifrada fuera de Turso y fuera del equipo o cuenta desde donde trabajas. Ajusta las cantidades a tu espacio disponible y al tiempo máximo de datos que aceptarías perder.

Programa la CLI desde un equipo o ejecutor que controles. Usa secretos del sistema o de ese ejecutor, permisos privados y un directorio de respaldo excluido de Git. El proceso debe registrar solo fecha, resultado, conteos y hash; nunca el contenido de los registros ni las credenciales. Comprueba el código de salida: `0` significa éxito y otro valor requiere revisión. Una ejecución fallida no debe borrar las últimas copias válidas.

La retención debe aplicarse después de verificar que existe una exportación nueva válida. No programes borrados de copias como parte de la importación. FARO no activa servicios externos, correos ni tareas programadas sin configuración del propietario.

## Recuperación de Turso y aislamiento

Revisa en la documentación y panel de Turso las prestaciones actuales del plan: copias, recuperación a un punto en el tiempo, ventanas de retención y exportación de base. Su disponibilidad y duración dependen del servicio; FARO no presupone una retención indefinida.

Las copias físicas, volcados SQL y recuperaciones completas de Turso pueden incluir todas las aplicaciones de una base compartida. No restaures un volcado completo sobre esa base para recuperar únicamente FARO. Recupera primero en una base separada y exporta los datos de FARO desde allí, o utiliza el JSON portable de FARO. Las migraciones de la aplicación solo nombran tablas `faro_` y no ejecutan sincronización destructiva de esquemas.

Haz un ensayo de recuperación trimestral en un destino temporal. Comprueba integridad de relaciones, zona horaria, revisiones, historial y deduplicación. Registra la fecha del ensayo y el tiempo empleado; un archivo que nunca se ha podido restaurar no demuestra que la recuperación funcione.

Referencias oficiales: [Turso](https://docs.turso.tech/), [límites de Vercel Functions](https://vercel.com/docs/functions/limitations), [libSQL](https://github.com/tursodatabase/libsql-client-ts).
