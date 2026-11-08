# Verificación de entrega

Verificado el **7 de noviembre de 2026**, zona `America/Lima`, con Node 24.22.1 y pnpm 11.25.0.

| Comprobación         | Resultado                                                             |
| -------------------- | --------------------------------------------------------------------- |
| `pnpm check`         | 0 errores, 0 advertencias, 0 sugerencias                              |
| `pnpm lint`          | Correcto                                                              |
| `pnpm format:check`  | Correcto                                                              |
| `pnpm test`          | 86 pruebas aprobadas en 10 archivos                                   |
| `pnpm test:e2e`      | 8 escenarios aprobados en Chromium                                    |
| `pnpm build`         | Build SSR y funciones Vercel generados correctamente                  |
| `pnpm peers check`   | Sin conflictos de dependencias pares                                  |
| Drizzle Kit          | Esquema y migración inicial coherentes                                |
| Revisión de secretos | Sin credenciales reales ni archivos `.env` de ejecución para publicar |

Las pruebas E2E verifican acceso privado y rechazo de solicitudes ajenas; creación y
edición mediante formularios; actividades retrospectivas con zona horaria; confirmación
de eliminaciones; navegación de los quince módulos; relaciones e historial; exportación y
restauración sin duplicados; preferencias compartidas entre dos contextos de navegador;
pantallas móviles; filtros históricos, calendario y alertas; cronómetro con pausa,
recarga y guardado único. Los controles esperan a completar su hidratación antes de
aceptar interacciones.

Las pruebas de integración utilizan **libSQL/SQLite real**, con bases aisladas. Comprueban
claves foráneas, transacciones, tablas exclusivamente `faro_`, preservación de tablas
ajenas, historial, cambios de frecuencia y prioridades, mediciones absolutas, concurrencia
de alertas, importación y respaldos mayores de 4 MiB. No usan datos personales reales.

La prueba de volumen usa diez años, 36.500 sesiones y 40 hábitos; verifica totales y
cumplimiento sin truncar períodos históricos. En una medición local, el análisis completo
tardó aproximadamente 3,4 segundos. No constituye una garantía de rendimiento de Vercel
ni mide la latencia de una base Turso remota.

## Configuración externa pendiente

No se dispuso de `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` ni credenciales de Vercel. Por ello,
no se ha probado una conexión Turso remota ni se ha publicado una URL de producción.
El cliente libSQL, las migraciones y el adaptador Vercel están preparados; producción
permanece cerrada sin la configuración privada requerida.

Sigue el [README](../README.md) para conectar Turso, aplicar las migraciones e importar
el repositorio en Vercel. La [guía de respaldo](backups.md) documenta la restauración
directa por CLI para archivos que exceden los límites HTTP de Vercel.
