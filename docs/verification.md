# Verificación de entrega

Verificado el **15 de noviembre de 2026**, zona `America/Lima`, con Node 24.22.1 y pnpm 11.25.0.

| Comprobación         | Resultado                                                                   |
| -------------------- | --------------------------------------------------------------------------- |
| `pnpm check`         | 0 errores, 0 advertencias, 0 sugerencias                                    |
| `pnpm lint`          | Correcto                                                                    |
| `pnpm format:check`  | Correcto                                                                    |
| `pnpm test`          | 101 pruebas aprobadas en 13 archivos                                        |
| `pnpm test:e2e`      | 11 escenarios aprobados en Chromium                                         |
| `pnpm build`         | Build SSR y funciones Vercel generados correctamente                        |
| `pnpm peers check`   | Sin conflictos de dependencias pares                                        |
| Drizzle Kit          | Esquema y dos migraciones coherentes; actualización desde versión 1 probada |
| Revisión de secretos | Sin credenciales reales ni archivos `.env` de ejecución para publicar       |

Las pruebas E2E verifican acceso privado y rechazo de solicitudes ajenas; creación y
edición mediante formularios; actividades retrospectivas con zona horaria; confirmación
de eliminaciones; navegación de los quince módulos; relaciones e historial; exportación y
restauración sin duplicados; preferencias compartidas entre dos contextos de navegador;
pantallas móviles; filtros históricos, calendario y alertas; cronómetro con pausa,
recarga y guardado único. El radar semanal verifica creación, arrastre, edición y limpieza de estimaciones, registro manual, semanas tipo, navegación desde revisiones conservando notas, cronómetro vinculado y presentación móvil. Los controles esperan a completar su hidratación antes de
aceptar interacciones.

Las pruebas de integración utilizan **libSQL/SQLite real**, con bases aisladas. Comprueban
claves foráneas, transacciones, tablas exclusivamente `faro_`, preservación de tablas
ajenas, planes independientes de sesiones, reintentos de registro, semanas tipo, selección explícita de pendientes, sugerencias por período, historial, cambios de frecuencia y prioridades, mediciones absolutas, concurrencia
de alertas, importación y respaldos mayores de 4 MiB. No usan datos personales reales.

La prueba de volumen usa diez años, 36.500 sesiones y 40 hábitos; verifica totales y
cumplimiento sin truncar períodos históricos. En una medición local, el análisis completo
tardó aproximadamente 3,4 segundos. No constituye una garantía de rendimiento de Vercel
ni mide la latencia de una base Turso remota.

## Migración y publicación

El esquema versión 2 añade `faro_planning`, `faro_planning_links` y
`faro_planning_history`. La migración generada no reconstruye tablas anteriores.
Una prueba comienza con el esquema versión 1 y registros guardados, aplica la nueva
migración y comprueba que los datos, las tablas ajenas y las claves foráneas permanecen
intactos. Los respaldos anteriores siguen siendo válidos; la exportación web y la CLI
incluyen planificación y su historial.

La migración remota se ejecuta mediante **Actions → Turso migrations**, utilizando los
secretos del repositorio únicamente durante el paso de migración. El flujo verifica las
nueve tablas FARO y la versión esperada sin imprimir filas personales ni credenciales.
Las pruebas locales emplean bases aisladas y no crean sesiones de ejemplo en producción.

Sigue el [README](../README.md) para configurar Turso y Vercel. La
[guía de respaldo](backups.md) documenta la restauración directa por CLI para archivos
que exceden los límites HTTP de Vercel.
