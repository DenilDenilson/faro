# Cálculos de FARO

Los indicadores usan registros persistidos. Un período sin sesiones se marca con `hasData: false`; el cero de un día dentro de un período es una cantidad válida, no una puntuación personal. El tiempo dedicado, la constancia, el cumplimiento de hábitos y el progreso de resultados se muestran como medidas distintas.

## Calendario y zona horaria

Las sesiones conservan un instante ISO. Para agruparlas se transforma ese instante a un día de la zona configurada, inicialmente `America/Lima`. Las semanas van de lunes a domingo. Los meses son meses del calendario; «mensual» no significa 30 días. Los períodos de N días se anclan a la fecha inicial del hábito. Las diferencias de días se calculan entre fechas del calendario y las medianoches locales resuelven los cambios de horario de verano, sin asumir que todos los días duran 24 horas.

No se incluyen sesiones futuras en el resumen de actividad realizada. Las fechas inicial/final de un filtro son inclusivas. La comparación utiliza el mismo número de días inmediatamente anteriores, y se expresa como diferencia de minutos, sin inventar un porcentaje cuando el período anterior carece de datos.

## Radar de atención

Cada interés tiene su propia frecuencia `frequencyDays`. La referencia es su última sesión o, si no existe, su creación. Un cambio explícito de frecuencia inicia una nueva ventana desde su fecha de modificación. El historial anterior se conserva y puede reconstruirse a partir del registro de cambios.

Se cuentan los días activos transcurridos, descontando intervalos auditados en pausa o archivados. Un interés pausado, archivado, cancelado o completado tiene estado **En pausa/Archivado** y no genera alertas de abandono.

La proporción de aviso parte de `attentionWarningRatio` (0,8 inicialmente), resta 0,1 si la prioridad es alta (3), resta 0,1 si el interés está en el foco de la temporada y suma 0,1 si está en exploración. Se limita al intervalo 0,1–1, como las preferencias de la aplicación. Una asignación explícita del interés en una temporada prevalece sobre la asignación más amplia de su área. La prioridad alta y la temporada adelantan el aviso; nunca cambian la frecuencia de vencimiento configurada.

`warningDays = max(1, min(frequencyDays, ceil(frequencyDays × proporción)))`

- **Desatendido:** días activos desde la referencia ≥ frecuencia propia.
- **Próximo a vencer:** días activos ≥ `warningDays` y todavía no vencido.
- **Sin datos suficientes:** todavía no existe una primera sesión y no ha llegado el aviso.
- **Al día:** existe una sesión y no se alcanzó el umbral de aviso.

Se muestra también el tiempo de calendario desde la última sesión, separado de los días activos usados para la regla. Los intereses sin sesiones no permanecen indefinidamente invisibles: tras su ventana inicial pueden necesitar atención. El radar ordena primero los estados que necesitan atención y después la prioridad; no genera una puntuación global de vida.

## Hábitos

Frecuencias admitidas: diaria, semanal, mensual, cada N días y días personalizados de la semana (domingo=0, lunes=1, sábado=6, como en los formularios y el formato de respaldo). El hábito personalizado utiliza una ventana semanal y señala los días elegidos. Se permiten sesiones retrospectivas y sesiones fuera del día sugerido, porque FARO registra actividad real y no impone una agenda rígida.

Si se configura una duración objetivo positiva, el cumplimiento se calcula por minutos; de lo contrario se calcula por número de sesiones únicas. La duración de una sesión vinculada varias veces al mismo hábito se cuenta una sola vez.

`progreso = min(1, cantidad realizada / meta del período)`

`completado = cantidad realizada ≥ meta del período`

En pausa, el progreso actual es desconocido (`null`) y no se trata como un fallo. Un período incompleto que intersecta una pausa se considera exento, sin inventar una meta reducida. El historial usa la configuración auditada de cada período, por lo que editar las metas actuales no reescribe las anteriores. Para el cumplimiento agregado se excluyen períodos exentos y períodos aún abiertos que no se han completado:

`cumplimiento = períodos completos / períodos elegibles`

Si no hay períodos elegibles, el cumplimiento es `null`. La vista del hábito muestra un resumen de los últimos doce períodos y su calendario de sesiones; las estadísticas consultan todo el intervalo seleccionado. Las rachas son opcionales, se calculan sobre el historial completo, omiten períodos exentos y se interrumpen en el primer período cerrado no completado. No son el indicador principal del producto.

## Tiempo y atribución

El total general es la suma de la duración de cada sesión única. Las relaciones con objetivos, hábitos, proyectos o aprendizajes no crean copias de la sesión.

Para evitar que una gráfica acumule más tiempo que el real, una sesión con N intereses reparte su duración por igual entre ellos. Las áreas reciben las fracciones de sus intereses; cuando existe historia de cambios, se conserva el área que tenía el interés al ocurrir la sesión. Una sesión de 90 minutos vinculada a dos intereses aporta 90 minutos al total y 45 minutos a cada interés. Al filtrar un interés se muestra su fracción atribuida y el número de sesiones únicas en las que participó. Las distribuciones por proyectos reparten igualmente el tiempo entre los proyectos vinculados; el tiempo sin proyecto se muestra como tal. Las fracciones se mantienen sin redondear en la lógica y se formatean al presentarlas.

La constancia es el número de días con al menos una sesión. Las series diarias, semanales, mensuales y anuales comparten los mismos registros y reglas de agrupación. La evolución de frecuencia muestra sesiones, días atendidos y separación media entre días atendidos por interés/mes. Con menos de dos días no se inventa una separación media.

## Objetivos y proyectos

El progreso medible de un objetivo procede de su valor inicial/actual explícito o del último registro de avance acumulado; registrar una sesión no aumenta automáticamente ese valor. Se conserva un valor inicial (`baselineValue`) cuando existe. Una edición manual posterior del valor actual genera una medición explícita, por lo que la lista, el detalle y las estadísticas consultan la misma historia. Al eliminar todas las mediciones se restaura ese valor inicial; si nunca se definió uno, el resultado vuelve a desconocido en lugar de inventar cero. Las mediciones futuras no se presentan como avance realizado.

`progreso de objetivo = valor actual / meta positiva`, limitado a 0–1.

Si falta una meta positiva o un valor actual, se devuelve `null`. Los avances son mediciones acumuladas, no incrementos que se suman implícitamente.

El progreso de un proyecto por entregables es `hitos completados / hitos no cancelados ni archivados`. Sin hitos, es desconocido. El estado del proyecto y sus notas de avance pueden consultarse por separado. El tiempo trabajado nunca se convierte en porcentaje de avance.

## Revisión semanal y alertas

La revisión suma sesiones únicas de la semana, identifica los objetivos/proyectos vinculados y los avances/hitos completados, y compara con la semana anterior. El cumplimiento de hábitos se evalúa según sus ventanas propias. Una revisión guardada conserva las reflexiones, logros, dificultades, decisiones y prioridades; el resumen permite consultar los registros reales y sus ediciones posteriores.

Las alertas se derivan al consultar la aplicación. Tienen identificadores estables por condición o período, de modo que una misma condición no crea copias. Se pueden desactivar por tipo, descartar por identificador o posponer hasta un instante. Las alertas de revisión corresponden a la semana anterior y no aparecen en una cuenta sin historia previa. Las de objetivos usan su fecha final y el número configurable de días de aviso.

La inactividad de proyectos se mide desde la última sesión, avance explícito o hito completado; descuenta pausas auditadas y abre una ventana nueva al reanudar. No considera avances futuros. Un descarte sigue vigente mientras la condición conserva su identificador; una nueva sesión o un nuevo período puede originar una nueva condición.

## Cronología

La memoria personal combina sesiones, creación de intereses/hábitos, aprendizajes, temporadas, revisiones, hitos, avances y resultados completados. Las fechas de finalización se recuperan del historial de transición a completado, para que editar después una descripción no traslade un logro en el tiempo. Los eventos admiten filtros cronológicos, por tipo, área, interés y texto, y se presentan de forma paginada.
