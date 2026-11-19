# Decisión de arquitectura: Demi como fuente central de información personal

Fecha: 19 de noviembre de 2026.
Estado: decisión aceptada por el propietario; implementación y migración pendientes.

## Decisión

Toda la información personal del propietario debe centralizarse en el servidor
de Demi. Demi será el asistente personal y la fuente de verdad de esa información,
incluidos los datos que actualmente conserva FARO.

FARO evolucionará hacia una interfaz de visualización, planificación y síntesis
conectada a Demi. La interpretación de instrucciones en lenguaje natural se
centralizará en Demi, utilizando su integración con Codex App Server.

Esta decisión sustituye la propuesta anterior de conservar FARO/Turso como fuente
principal de la agenda y usar Demi únicamente para interpretar y enviar acciones.
La arquitectura objetivo es que Demi custodie los datos y su estado autoritativo.

## Alcance de la información

El alcance incluye los datos personales actuales de FARO: áreas de vida, intereses,
hábitos, objetivos, proyectos, hitos, actividades y sesiones, tareas semanales,
semanas tipo, revisiones, temporadas, aprendizajes y avances. También comprende
Mi norte: visiones y sus versiones, claves de poder, indicadores, mediciones y
revisiones de rumbo; además de preferencias, relaciones e historiales.

Estos datos deberán integrarse con los dominios personales que ya administra
Demi. La centralización corresponde a su backend y almacenamiento persistente;
el contexto enviado al modelo se seleccionará según cada petición, sin depender
del historial de un hilo como base de datos.

## Responsabilidades en la arquitectura objetivo

- **Demi:** conservar la información personal y su historial, validar operaciones,
  coordinar la interpretación mediante Codex y atender los canales de interacción,
  incluido Telegram.
- **FARO:** presentar la información, el planificador y las síntesis. Las altas,
  ediciones y cambios de estado realizados desde su interfaz deberán reflejarse
  en Demi mediante el contrato de integración que se diseñe.
- **Codex App Server:** interpretar las intenciones dentro de la infraestructura de
  Demi. La validación y la persistencia corresponden a los servicios de dominio.
- **Integración:** mantener una identidad y un estado coherentes para cada registro.
  Una tarea no debe tener dos versiones autoritativas independientes en FARO y Demi.

El contrato de API, la autenticación entre servicios, el esquema de destino y
cualquier uso de caché o MCP quedan pendientes de diseño. Esta decisión no fija
todavía endpoints, tecnología de migración ni cambios de hosting.

## Migración futura

El propietario acepta que habrá que migrar la información existente si es
necesario para alcanzar esta arquitectura.

La migración deberá preservar las relaciones, identificadores o sus equivalencias,
fechas, zona horaria, estados, unidades, mediciones e historiales. Se conservarán
las reglas de FARO: una tarea prevista o marcada como completada no inventa una
sesión ni minutos reales; los objetivos y proyectos mantienen sus medidas e hitos.

Antes de ejecutar la migración se prepararán el mapeo de datos, los respaldos,
un ensayo y la validación de integridad y resultados. El cambio de fuente deberá
evitar dos agendas independientes y prever cómo recuperar el servicio si falla.

Registrar esta decisión no autoriza a ejecutar ahora la migración ni a eliminar
datos, retirar Turso o cambiar credenciales o despliegues.

## Estado actual y alcance de esta anotación

FARO sigue funcionando con su arquitectura actual y Turso como fuente de verdad.
Las instrucciones y la documentación operativa existentes describen ese estado;
se actualizarán cuando se implemente y valide la transición a Demi.

Este cambio es exclusivamente documental. No implementa la integración, no
modifica código de aplicación y no mueve datos personales.

## Continuidad del desarrollo

El propietario prevé continuar trabajando cómodamente desde clones locales de los
repositorios, con la posibilidad de retomar cambios desde Codex en la nube.

Este documento conserva la decisión en Git para que acompañe al clon y pueda
consultarse desde distintos entornos o hilos. Al retomar la integración se debe leer
junto con `AGENTS.md` y la documentación de ambos proyectos, sin asumir que los
hilos comparten contexto automáticamente.

Repositorios relacionados:

- FARO: <https://github.com/DenilDenilson/faro>
- Demi Server: <https://github.com/DenilDenilson/demi-server>
