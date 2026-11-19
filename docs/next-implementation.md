# Requisitos de la implementación de Mi norte y el planificador

Anotado el 16 de noviembre de 2026 por petición del usuario.

Estado: implementado por autorización posterior del usuario («Implementa ahora»). La validación se documenta en `docs/verification.md`.

## Intereses agrupados por área

En la vista principal de Intereses (`/interests`), agrupar los intereses por el área
de vida a la que pertenecen. El nombre de cada área debe verse como encabezado de
su grupo, al entrar en la página, sin tener que aplicar un filtro.

Conservar la búsqueda, los filtros y el acceso a los detalles y la edición.

Criterio de aceptación: se puede reconocer de un vistazo qué intereses pertenecen
a cada área desde el listado principal.

## Radar semanal como planificador

En «Mi semana» del Radar (`/attention`), mostrar los proyectos y objetivos
pendientes o en curso junto con los hábitos existentes.

La intención del usuario es entrar y saber rápidamente qué proyectos y objetivos
tiene por atender, para decidir qué trabajar y organizar su semana.

- Incluir los pendientes que todavía no tengan una práctica asignada a la semana.
- Presentar un resumen compacto con nombre y estado; aprovechar prioridad, fechas
  o próximos hitos cuando estén definidos.
- Dar acceso directo al detalle del objetivo o proyecto.
- Facilitar elegir y ubicar una próxima acción vinculada en la semana.
- Mantener visible el calendario y el seguimiento de hábitos ya implementados.
- Conservar las reglas de progreso: planificar una acción no completa un objetivo,
  un proyecto ni sus hitos.

Criterio de aceptación: desde el Radar semanal se pueden identificar los proyectos
y objetivos abiertos y acceder a ellos sin recorrer sus secciones por separado,
aunque aún no tengan actividades planificadas.

## Mi norte y conexiones implementadas

La implementación también incluye visión personal y sus versiones; fuentes de poder
con indicadores, referencias personales y mediciones; claves de poder vinculadas a
objetivos, prácticas y aprendizajes; propósito, influencia y alternativas en objetivos;
revisiones de rumbo y campos de estrategia en las revisiones semanales. Los avances
siguen basándose en medidas explícitas y actividad real.

## Ampliación del 19 de noviembre de 2026: tareas independientes

Implementada por petición del usuario: crear tareas libres desde la semana o un día, sin
interés, hábito, proyecto, objetivo ni área obligatorios. Admiten hora y duración estimada
opcionales, se ordenan por hora y pueden completarse o reabrirse sin registrar sesiones.
El calendario, los filtros, las semanas tipo, la selección de pendientes y los respaldos
conservan este flujo. Los hábitos y las métricas siguen usando sesiones reales.
