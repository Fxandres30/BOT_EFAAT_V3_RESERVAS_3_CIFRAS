# Auditoría de preparación para el lanzamiento — Fase 3

07/11/2026 · Solo diagnóstico: no se modificó código, textos, datos ni producción. Cada intervención propuesta espera autorización por separado.

Relacionados: [LAUNCH_VISIBILITY.md](LAUNCH_VISIBILITY.md) · [FEATURE_VISIBILITY_REGISTER.md](FEATURE_VISIBILITY_REGISTER.md) · [RIESGOS_Y_DECISIONES.md](RIESGOS_Y_DECISIONES.md)

## 0. Método y límites

- Se leyeron el código del panel (`frontend/`), la landing (`components/landing/`, `lib/comercial/planes.ts`) y las piezas del backend que respaldan cada promesa.
- **No se consultó producción** (Supabase, VPS ni Vercel). Lo que depende de producción se marca «No comprobado» o se cita de notas internas con su fecha.
- No se recorrió el panel con una sesión real: la auditoría de experiencia se hizo sobre el código (textos, estados vacíos, botones, rutas).
- «Comprobado» significa comprobado en el código y en las pruebas automáticas (`npm test`: panel 40/40, backend 181/182 con 1 fallo conocido, 07/11/2026), no en producción.

### Estado de Git

Al empezar (rama `main`, `8379d0fa`): sin commit las Fases 1–2 de visibilidad, el orquestador de mensajes (`backend/shared/mensajes/`, `backend/tests/mensajes-o0/`, `-o1/`) y cambios de otra sesión (`backend/automation/scheduler.js`, `sombraInicioDia.js`, `backend/tests/mensajes-o2/`).

**Durante la auditoría** el usuario hizo commit y push de todo eso: `ab7da28d` (07/11 13:09, «SORTEOS PROGRAMADOS_0001»), `main` = `origin/main`. Las Fases 1–2 están por tanto en `origin/main` (push = despliegue en Vercel; el despliegue no se comprobó). Siguen apareciendo cambios nuevos de otra sesión (`backend/automation/engine.js`, `messageSelector.js`, `sombraAutomatizacion.js`, `backend/tests/mensajes-o1/o1Aislamiento.test.js`, `backend/tests/mensajes-o3/`): no tocados.

Esta fase solo añade este documento, su línea en `docs/README.md` y la sección «Candidatas propuestas» del registro.

## 1. Estado real de la landing

Clases: **Comprobado** (código + pruebas) · **Parcial** · **En desarrollo** · **Oculto** · **No comprobado** (depende de producción).

| # | Promesa (landing) | Clase | Evidencia | Propuesta |
|---|---|---|---|---|
| L1 | Portada: «atiende las reservas… responde… lleva la tabla al día. Tú publicas, confirmas pagos» | Comprobado | Flujo central de reservas y respuestas; suites de backend | Conservar |
| L2 | Reservas de números («aparta si están libres, avisando cuáles ya estaban ocupados») | Comprobado | `detectarReserva.js`, `validarReservas.js`, `reservarNumeros.js` | Conservar |
| L3 | Asignación automática de números | Comprobado | Igual que L2 | Conservar |
| L4 | Reacciones ✅ / ❌ / ninguna si es parcial | Comprobado | `reaccionReserva.js` coincide palabra por palabra | Conservar |
| L5 | Conexión con código QR y estado en el panel | Comprobado | Sesiones, `/conectar/[id]` | Conservar |
| L6 | Panel desde computador o celular | Comprobado | PWA (`/app`, manifest) | Conservar |
| L7 | Grupos: elegir dónde trabaja EFAAT y dónde se publica | Comprobado | Automatización › Grupos; selector de grupos de sorteos | Conservar |
| L8 | Tablas para compartir e imprimir | Parcial / No comprobado | Captura en el panel y `/tablas/imprimir` existen; el envío a grupos depende del servidor actualizado | Conservar; probar en producción |
| L9 | Sorteos instantáneos | No comprobado | Código en `main`; publicación depende del Droplet (notas 30/10: despliegue pendiente) | Conservar solo tras una publicación real correcta |
| L10 | Sorteos programados: tabla, recordatorios y aviso de cierre | Parcial / No comprobado | Auditoría 30/10: 13 de 16 programados fallaron por la captura en el Droplet; la imagen generada en servidor (F4-G) no está desplegada | **Verificar antes de anunciar**; si falla, presentarlo como «en verificación» |
| L11 | Confirmación de pagos uno a uno o varios, con historial | Parcial | Pago por lote requiere servidor actualizado; historial completo depende de la 032 (estado contradictorio); pagos sin contacto bloqueados (041 sin aplicar) | Conservar «marca como pagados»; matizar «historial» hasta verificar la 032 |
| L12 | «Configura una tabla de números para cada precio» | **Parcial** | `lib/tablasConfig.ts`: 8 precios fijos en **2 cuadrículas físicas** (1.000/1.500/2.000 comparten una; 3.000–15.000 la otra). Prueba `independenciaPorPrecio` falla (conocido) | **Modificar**: «Elige entre los precios disponibles y mira en vivo…». No prometer una tabla por precio |
| L13 | Consultas: números propios, **pagos pendientes**, disponibles | Parcial / No comprobado | Números propios y disponibilidad: sí. Consultas de pago: notas 23/10 indican tipos `consulta_pago_*` apagados en producción | Verificar en producción; si siguen apagados, quitar «conocer sus pagos pendientes» |
| L14 | Plantillas: «varios estilos» y «variables» | Parcial | Respuestas editables con variables: sí. Estilos de mensajes de sorteo dependen de la 042 (sin aplicar, 31/10) | Conservar «escribe las tuyas con variables»; matizar «estilos» |
| L15 | **Bloqueos: «si uno vuelve a entrar a tus grupos, EFAAT lo retira automáticamente»** | **Oculto / En desarrollo** | Pantalla oculta (Fase 1). `configExpulsiones.js`: modo `desactivado` por defecto; solo es real con `BLOQUEO_EXPULSION_MODO=real` + `BLOQUEO_EXPULSION_CONFIRMAR=SI`. Notas 06/11: desactivado en el servidor | **Retirar temporalmente** la expulsión automática. Texto posible: «Bloquea a un participante desde su perfil: deja de recibir respuestas y no puede reservar» |
| L16 | Recomendación «haz administrador al número… como expulsar participantes bloqueados y abrir o cerrar grupos» (y la pregunta frecuente equivalente) | Parcial | Ambos ejemplos no están activos: expulsión desactivada; apertura y cierre «en ajuste» según la propia landing | **Modificar** los ejemplos; conservar la recomendación |
| L17 | «En verificación»: confirmación con sticker; apertura y cierre automático | En desarrollo (bien rotulado) | Galería de stickers depende de la 046 (sin aplicar) | Conservar como está |
| L18 | Demo interactiva: confirmación de pago con sticker | Incoherente con L17 | `DemoSorteo.tsx` la presenta como el flujo normal; la landing la declara en verificación | **Modificar**: rotular el paso del sticker como «en verificación» dentro de la demo |
| L19 | Planes: grupos 1/2/5/10, «tablas de configuración» 1/2/5/10, «secciones de respaldo» 1/2/5/10, programados solo desde Profesional, «configuración independiente por grupo» desde Profesional, «2 plantillas por categoría» | **No aplicado por el sistema** | `planes.ts`: «Ninguna parte del sistema las aplica todavía». Sin límites en backend. «Tablas de configuración» no existe como concepto (ver L12); «secciones de respaldo» se llama «Sesiones» en el panel; nada limita a 2 plantillas | **Modificar**: conservar precios y grupos (control manual del equipo); retirar «tablas de configuración» y «2 plantillas por categoría»; renombrar «secciones de respaldo» → «sesiones de respaldo» |
| L20 | Prueba de 3 días «queda pendiente hasta que la revisemos» | Parcial | Es manual y honesto, **pero `/register` está abierto** y enlazado desde `/login`: cualquiera crea una cuenta y usa el panel sin prueba ni plan | Ver riesgo K1 |
| L21 | Sesiones: respaldo «en espera», cambio automático no garantizado | Comprobado (texto prudente) | Coincide con Sesiones | Conservar |
| L22 | Lector de pagos | No anunciado | La landing no lo menciona | Mantener sin anunciar |

## 2. Promesas comerciales que necesitan revisión (priorizado)

1. **L15 / L16**: expulsión automática de bloqueados. Hoy no ocurre. Retirar o reformular.
2. **L12 / L19**: «una tabla para cada precio» y «tablas de configuración 1/2/5/10». No corresponden a la arquitectura actual (2 cuadrículas compartidas).
3. **L10 / L9**: publicación de programados e instantáneos. Anunciarlos solo después de una prueba real en producción.
4. **L19**: límites por plan no aplicados, «2 plantillas por categoría» sin significado en el sistema y «secciones de respaldo» con otro nombre que el panel.
5. **L18**: la demo muestra el sticker como función normal.
6. **L13 / L14 / L11**: matizar pagos pendientes, estilos de plantillas e historial hasta verificar en producción.

## 3. Funcionalidades listas (comprobadas en código y pruebas)

Reservas por WhatsApp y asignación automática · respuestas automáticas y reacciones ✅/❌ · consulta de números propios y disponibilidad · vinculación por QR y estado de sesiones · selección de grupos · tablas en vivo por precio (con la limitación de L12) · marcar pagado / liberar desde el panel · edición de mensajes con variables y vista previa · calendario de loterías · inicio de sesión y recuperación de contraseña (la recuperación depende de la configuración de correo de Supabase, sin verificar).

## 4. Funcionalidades parcialmente terminadas

| Funcionalidad | Qué falta |
|---|---|
| Sorteos programados | Prueba real en producción; desplegar la generación de imagen en servidor |
| Sorteos instantáneos / Compartir a grupos | Servidor actualizado y prueba real |
| Pago por lote e historial de números | Servidor actualizado; verificar la 032 |
| Consultas de pago por WhatsApp | Verificar si `consulta_pago_*` siguen apagados en producción |
| Estilos de mensajes de sorteo | Migración 042 |
| Modalidad 3 cifras (pago y gratis) | No hay tabla 000–999: opciones deshabilitadas en el formulario, botón deshabilitado en las tarjetas y bloques «0 activos» en Eventos |
| Mi cuenta (plan, vigencia, pagos, cupo de grupos) | No existen en la base: todo aparece «No registrado» |
| Contactos (directorio completo) | Aviso «todavía no está disponible en tu cuenta» si falta su migración |
| Aprende | Solo Sesiones y Reservas tienen guías; 8 categorías muestran «Guía en preparación» |
| Confirmación con sticker, apertura/cierre de grupos | En verificación (la landing ya lo dice) |

## 5. Funcionalidades que todavía no deben anunciarse

Expulsión automática de bloqueados · Lector de pagos · Resultados / número ganador · Sorteos de 3 cifras · confirmación de pagos con sticker como función garantizada · apertura y cierre automático de grupos · límites por plan aplicados por el sistema · cambio automático a la sesión de respaldo · cuadrícula independiente por precio.

## 6. Problemas de experiencia de usuario

### Prioridad alta

| Id | Problema | Dónde |
|---|---|---|
| U1 | Mensajes técnicos visibles: «Reinicia el backend (PM2)…», «hay que reiniciar el backend con la versión nueva» | `EventoGrid.tsx:141`, `AccionesSorteo.tsx:164` |
| U2 | Nombre interno de tabla visible: «Este grupo todavía no está en **grupos_autorizados**» | `ConfiguracionGrupo.tsx:250` |
| U3 | Errores crudos de la base entre paréntesis («No se pudo cargar la configuración (…mensaje técnico…)») | `CentroMensajes.tsx:59`, `ConfiguracionGrupo.tsx:98` |
| U4 | Registro e inicio de sesión muestran el mensaje original de Supabase (en inglés) cuando no es un caso conocido | `RegisterForm.tsx:72`, `LoginForm.tsx:19` |
| U5 | Avisos que delatan migraciones pendientes: «La auditoría de operaciones aún no está activada en la base», «El registro de operaciones… todavía no está activado», «El historial de este número todavía no está disponible en tu cuenta» | `HistorialNumeros.tsx:119`, `DetalleSorteoModal.tsx:114`, `HistorialNumero.tsx:37` |
| U6 | Catálogo «Activadores y acciones» (botón en Mensajes): muestra a los clientes estados internos («Con conflicto conocido», «Sin efecto», «Sin uso»; 6 entradas) y un resumen «N con conflicto conocido» | `MensajesPage.tsx:436`, `ActivadoresModal.tsx` |
| U7 | Modalidad 3 cifras: bloques «3 cifras pago / gratis — 0 activos» en Eventos, opciones «(no disponible)» en el formulario y botón «Ver tabla de reservas» deshabilitado | `EventoGrid.tsx` (resumen), `FormularioSorteo.tsx:493-494`, `EventoTresCifrasCard.tsx:112` |

### Prioridad media

| Id | Problema | Dónde |
|---|---|---|
| U8 | Acciones del sorteo: hasta 7 botones parecidos (Cerrar aquí, Desactivar aquí, Reabrir aquí, Desactivar en todos, Cerrar en todos, Cancelar sorteo, Eliminar). La diferencia solo se explica después de pulsar | `AccionesSorteo.tsx` |
| U9 | Mi cuenta: Suscripción, Pagos y renovaciones y Mis grupos muestran casi todo «No registrado» | `components/cuenta/*` |
| U10 | Variables globales: concepto técnico; la descripción enseña conteos internos («N del sistema + …») | `VariablesGlobalesPage.tsx:392` |
| U11 | Sesiones: descripción mínima («Gestiona tus sesiones de WhatsApp.») para la primera pantalla tras el inicio de sesión | `SessionsPage.tsx:57` |
| U12 | Aprende: 8 de 10 categorías dicen «Guía en preparación» | `CentroAprendizaje.tsx` |
| U13 | Precios compartidos: un número reservado en el sorteo de $1.000 aparece ocupado en el de $2.000 (misma cuadrícula). Nada en Reservas lo explica | `lib/tablasConfig.ts`, Reservas |

## 7. Problemas de navegación

| Id | Problema |
|---|---|
| N1 | «Mensajes» existe dos veces: en el menú (`/mensajes`, respuestas) y como pestaña de Automatización (`/automatizacion/mensajes`) — **Resuelto 07/11 (local):** la pestaña se retiró; `/mensajes` tiene «Respuestas a clientes» y «Mensajes de automatización»; la ruta antigua redirige. |
| N2 | Tres «centros»: Eventos se presenta como «Centro de control de tus sorteos»; la pestaña de Automatización «Centro de control» abre una página titulada «Centro de automatizaciones» — **parcial 07/11:** la página ya se titula «Centro de control»; Eventos conserva su frase. |
| N3 | Nombres distintos para lo mismo: menú «Programados» / página «Sorteos programados»; menú «Reservas» / ruta `/tablas` / landing «Tablas»; landing «secciones de respaldo» / panel «Sesiones» |
| N4 | Orden del menú frente a la primera configuración: autorizar grupos (paso necesario) está en Automatización, la última opción, en «Control» |
| N5 | Tres puntos de entrada para crear sorteos (Eventos › acciones, Programados, Publicar ahora): correcto, pero sin una guía que explique cuándo usar cada uno (Aprende «en preparación») |
| N6 | `/lector-pagos` y `/bloqueados` abren escribiendo la dirección (acceso administrativo, documentado). Sin enlaces visibles desde la Fase 2 |

## 8. Nuevas candidatas a ocultamiento (propuesta, sin autorizar)

| Candidata | Motivo | Propuesta |
|---|---|---|
| C1 · Catálogo «Activadores y acciones» (Mensajes) | Herramienta de diagnóstico interno con estados que alarman al cliente (U6) | Ocultar el botón con `esVisible` |
| C2 · Modalidad 3 cifras | No funciona sin tabla 000–999 (U7) | Ocultar bloques, opciones y tarjetas de 3 cifras con `esVisible` |
| C3 · Mi cuenta › Pagos y renovaciones | Sin datos: solo «No registrado» (U9) | Ocultar la subsección; dejar el contacto con soporte |
| C4 · Categorías de Aprende sin guías | 8 tarjetas «en preparación» (U12) | Mostrar solo categorías con artículos (o mantener con texto más claro) |
| C5 · Variables globales (menú) | Concepto avanzado para un cliente nuevo (U10) | Decisión de producto: ocultar del menú o dejar con mejor descripción |

## 9. Riesgos de lanzamiento

| Id | Riesgo | Evidencia | Gravedad |
|---|---|---|---|
| K1 | **Registro abierto**: cualquiera crea una cuenta desde `/login` › «Crear cuenta» y puede vincular WhatsApp y operar sin prueba ni plan | `LoginForm.tsx:146`, `RegisterForm.tsx` | Alta |
| K2 | **Datos personales expuestos**: R4, «25 tablas heredadas con datos personales legibles por anon»; SQL preparado y sin aplicar | `RIESGOS_Y_DECISIONES.md` (auditoría 30/10, sin verificar hoy) | Alta (protección de datos de participantes) |
| K3 | Promesa de expulsión automática que no ocurre (L15) | `configExpulsiones.js` | Alta (comercial) |
| K4 | Publicación de programados sin verificar en producción (L10) | Auditoría 30/10 | Alta (función central de planes Profesional+) |
| K5 | Límites de plan no aplicados: un cliente Esencial ve y usa Programados y puede autorizar más grupos de los contratados | `planes.ts`; sin límites en backend | Media (control manual) |
| K6 | Precios que comparten cuadrícula (L12/U13): confusión o conflictos si un cliente usa dos precios del mismo grupo a la vez | `tablasConfig.ts`; `independenciaPorPrecio` | Media |
| K7 | Migraciones pendientes o sin verificar de las que dependen funciones visibles: 032, 034, 039, 041, 042, 044, 046 | `RIESGOS_Y_DECISIONES.md` | Media |
| K8 | Servidor (Droplet) posiblemente sin el código actual: lotes, instantáneos, imagen en servidor y textos sin «bot» dependen de desplegarlo | Notas 28/10–06/11 | Media |
| K9 | Mensajes técnicos visibles (U1–U5) | Ver §6 | Baja–media (imagen) |

## 10. Plan recomendado (cada punto, autorización separada)

**Bloque A — antes de recibir clientes (bloqueantes)**
1. K1: decidir el registro (cerrar `/register` o dejarlo, pero sin acceso operativo hasta que el equipo active la cuenta). Requiere decisión de producto.
2. K2: revisar y aplicar, con autorización, el SQL de exposición de tablas heredadas (Partes preparadas). Requiere ventana de cambios en Supabase.
3. K4/K8: desplegar el servidor con el código actual y hacer una prueba real de programado, instantáneo, Compartir y pago por lote en un grupo de prueba.
4. Landing, textos L15, L16, L12 y L19 (lista exacta en §1). Solo textos; sin código.

**Bloque B — primera semana**

5. U1–U5: sustituir mensajes técnicos por textos para el cliente (solo textos de interfaz).
6. C1 y C2: ocultar el catálogo de activadores y la modalidad 3 cifras con el sistema de visibilidad.
7. L18: rotular el sticker en la demo como «en verificación».
8. Verificar en producción `consulta_pago_*` y la 032; ajustar L11 y L13 según el resultado.

**Bloque C — después**

9. N1–N3: unificar nombres (Mensajes / Centro de control / Programados / Reservas).
10. U8: explicar cada acción del sorteo antes de pulsar (texto de ayuda o agrupación).
11. C3–C5 y Aprende: decidir qué se oculta y escribir guías de Eventos, Programados, Publicar ahora y Automatización.
12. K5–K6: límites por plan y cuadrícula por precio (opción B ya decidida en E0): proyectos con migraciones.

**Pruebas pendientes para cerrar esta auditoría**: recorrido manual con una cuenta nueva (registro → Sesiones → Automatización › Grupos → Mensajes → Publicar ahora → Reservas → pago → Eventos) en el panel desplegado, y verificación de producción de los puntos «No comprobado».
