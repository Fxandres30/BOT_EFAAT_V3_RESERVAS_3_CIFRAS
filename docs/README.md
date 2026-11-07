# Documentación de EFAAT

Índice principal (creado en F1-C, 06/11/2026). Empieza por **Estado actual**; el resto es referencia.

## Estado actual

| Documento | Para qué |
|---|---|
| [RIESGOS_Y_DECISIONES.md](RIESGOS_Y_DECISIONES.md) | Migraciones (estado observado), riesgos abiertos y decisiones que esperan autorización |
| [LAUNCH_VISIBILITY.md](LAUNCH_VISIBILITY.md) | Qué se muestra y qué está oculto en el lanzamiento comercial, motivos e historial |
| [FEATURE_VISIBILITY_REGISTER.md](FEATURE_VISIBILITY_REGISTER.md) | Registro de cada funcionalidad oculta: archivos, estado, qué falta y cómo reactivarla |
| [pruebas/LINEA_BASE.md](pruebas/LINEA_BASE.md) | Cómo ejecutar `npm test` de forma segura, línea base y caracterizaciones C1–C5 |

## Arquitectura

| Documento | Contenido |
|---|---|
| [arquitectura/MAPA_ACTUAL.md](arquitectura/MAPA_ACTUAL.md) | Piezas, despliegue, endpoints del backend, procesos periódicos y capas |
| [arquitectura/FUENTES_UNICAS.md](arquitectura/FUENTES_UNICAS.md) | Dónde vive cada regla, sus espejos y la prueba que los mantiene iguales |
| [arquitectura/ESTADO_SORTEOS.md](arquitectura/ESTADO_SORTEOS.md) | F2: criterios del estado de un sorteo, consumidores migrados, los que conservan criterio propio, reserva excepcional propuesta y decisiones pendientes |
| [arquitectura/F3_CIERRE_REAPERTURA.md](arquitectura/F3_CIERRE_REAPERTURA.md) | F3 (implementada y endurecida en local): orquestador central, 12 modalidades conservadas, reapertura con ciclo, normalización, permiso de reservas independiente del estado, riesgos, pruebas, decisiones y auditoría (anexo A) |
| [arquitectura/F4_CREACION_PUBLICACION.md](arquitectura/F4_CREACION_PUBLICACION.md) | F4-A/B (solo auditoría y diseño): caminos de creación y publicación, duplicaciones, núcleo de activación por entradas, riesgos de concurrencia, C2, plan para independenciaPorPrecio, etapas F4-C a F4-H |
| [activacion/PROCEDIMIENTO_DIAGNOSTICO_ESTADOS.md](activacion/PROCEDIMIENTO_DIAGNOSTICO_ESTADOS.md) | Cómo ejecutar (con autorización) y leer el diagnóstico de estados contradictorios |
| [arquitectura/DUPLICACIONES_PENDIENTES.md](arquitectura/DUPLICACIONES_PENDIENTES.md) | D1–D13, con la fase propuesta |
| [arquitectura/CODIGO_MUERTO_CANDIDATOS.md](arquitectura/CODIGO_MUERTO_CANDIDATOS.md) | Candidatos sin importadores y qué confirmar antes de borrar |

## Panel (frontend)

| Documento | Contenido |
|---|---|
| [frontend/NAVEGACION_Y_RUTAS.md](frontend/NAVEGACION_Y_RUTAS.md) | Barra lateral, navegaciones secundarias, todas las páginas y rutas API |
| [frontend/INVENTARIO_VISUAL.md](frontend/INVENTARIO_VISUAL.md) | Pantalla → componente, tamaño por área y rasgos visuales actuales |
| [frontend/COMPONENTES_UI.md](frontend/COMPONENTES_UI.md) | Componentes base y su uso, duplicados y componentes sin uso |

## Activación y operación

| Carpeta / documento | Contenido |
|---|---|
| [activacion/ACTIVACION.md](activacion/ACTIVACION.md) | Guía de activación por partes (RLS, compradores, sesiones, mensajes) |
| [activacion/](activacion/) | Una guía por función (`RESERVA_MANUAL`, `COMPARTIR_TABLA`, `CIERRE_Y_PAGOS`, `UN_SORTEO_ACTIVO_POR_PRECIO`, `AISLAMIENTO_POR_PRECIO`, `TOKEN_SERVICIO`, `FRONTEND_URL`, `VERIFICAR_REALTIME`…) y sus consultas. Los archivos `*_solo_lectura.sql` solo leen; el resto **escribe** y requiere autorización |
| [activacion/verificar_032_solo_lectura.sql](activacion/verificar_032_solo_lectura.sql) | Comprueba si la 032 está aplicada completa (no ejecutado) |
| [inactividad/RUNBOOK_022.md](inactividad/RUNBOOK_022.md) | Control de inactividad de 15 días |
| [recuperacion/INFORME_2026-10-16.md](recuperacion/INFORME_2026-10-16.md) | Incidente del panel del 16/10 |
| [ANALITICA_PRIVADA.md](ANALITICA_PRIVADA.md) | Analítica privada |
| [`backend/pagos/README.md`](../backend/pagos/README.md) | Lector de pagos Android |

## Automatización (especificación histórica)

[EFAAT_AUTOMATION_MASTER_SPEC.md](EFAAT_AUTOMATION_MASTER_SPEC.md), [EFAAT_AUTOMATION_ROADMAP.md](EFAAT_AUTOMATION_ROADMAP.md) y las fases [2A](EFAAT_AUTOMATION_PHASE_2A_FINDINGS.md), [2B](EFAAT_AUTOMATION_PHASE_2B_IMPLEMENTATION.md), [3](EFAAT_AUTOMATION_PHASE_3_IMPLEMENTATION.md), [4A](EFAAT_AUTOMATION_PHASE_4A_IMPLEMENTATION.md) y [4B](EFAAT_AUTOMATION_PHASE_4B_IMPLEMENTATION.md). Describen cómo se construyó el motor; para el estado actual manda [arquitectura/MAPA_ACTUAL.md](arquitectura/MAPA_ACTUAL.md).

## Migraciones

Están en [`backend/supabase_migrations/`](../backend/supabase_migrations/) (001–046). Se aplican **a mano** en el SQL Editor de Supabase; nada del repositorio las ejecuta.
