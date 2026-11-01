# Aislamiento por precio: diagnóstico y propuesta

Preparado el 01/11/2026. Todo es local. **No hay ninguna migración creada ni aplicada.**

Complementa [UN_SORTEO_ACTIVO_POR_PRECIO.md](UN_SORTEO_ACTIVO_POR_PRECIO.md), de la sesión de sorteos: allí se decide qué sorteos pueden estar activos a la vez; aquí, qué datos comparten.

**Regla:** cada precio es su propio sorteo. Puede compartir una cuadrícula física, pero nunca identidad, recaudo, contadores ni estadísticas.

## 1. Causa raíz

| Pieza | Hoy |
|---|---|
| Precio → tabla física | `tablas_cliente` (027), **por cliente y precio**. Las dos tablas actuales están fijadas por un `CHECK`. Base: $1.000–$2.000 → `reservas_dos_cifras`; $3.000–$15.000 → `5k_15k_reservas_2_cifras`. |
| Fila de un número | `(usuario_id, numero)` dentro de la tabla física. **No guarda el precio.** |
| Sorteo | `eventos_bot`, una fila por grupo. `identidad_evento_real` ya incluye el precio. |

Dos precios activos de la misma tabla física comparten **la misma fila** por número: el 07 de $3.000 y el 07 de $10.000 son una sola fila. Como todo el sistema trata la cuadrícula como «tabla física + cliente» (la regla «una tabla = un sorteo»), cada lectura mezcla los precios.

## 2. Diagnóstico por área (dos sorteos activos: A $3.000 y B $10.000)

| # | Área | Dónde | Resultado con la cuadrícula compartida |
|---|---|---|---|
| 1 | Modelo y configuración | `tablas_cliente`, `configEvento.js`, `lib/tablasConfig.ts` | El mapa ya es por precio, pero dos precios apuntan a la misma tabla. |
| 2 | Precio, sorteo, reserva y número | Filas de la tabla física | Una sola fila por número para los dos sorteos. La identidad de la fila conserva el sorteo de origen. |
| 3 | Recaudo | `resumenTabla.calcularResumenTabla` | B (sin ventas) muestra **$10.000**: el 07 pagado en A multiplicado por el precio de B. |
| 4 | Contadores | `sorteoReal.estadoDelSorteo`, `actualizarEvento`, `repo.contarNumerosTabla` | B muestra 1 pagado y 1 reservado que son de A. |
| 5 | Porcentaje de avance | `resumenTabla` (`ocupacion`) | B muestra 2 % sin haber vendido. |
| 6 | Panel administrativo | `sorteosActivos.listar`, `EventoCard`, Reservas y Tablas | Los mismos números en los dos sorteos. |
| 7 | Bot | `reservarNumeros`, `consultarMisNumeros`, sticker | En B no se puede reservar el 07 (ocupado por A). «¿Qué debo?» en el grupo de B cobra la reserva de A **al precio de B** ($10.000 en vez de $3.000). El sticker en B paga reservas de A. |
| 8 | Cierres automáticos | `procesarSorteo` (motivo «pagados»), `verificarEventoLleno`, `sorteoSinNumerosLibres` | **Si A vende los 100, B se cierra «por todos pagados»** (también su grupo de WhatsApp) sin haber vendido nada. El cierre por hora sí es independiente. |
| 9 | Reportes y estadísticas | Contadores de `eventos_bot`, perfil del contacto (por tabla y número), `reservas_actividad` y `reservas_auditoria` (por tabla), trigger heredado de `compradores_semanales` | Mezclados en el sorteo. El historial de un número es el de la fila, sin precio. |
| 10 | Realtime | `useTablaPrecio`: tabla + `usuario_id` | La vista de B recibe y muestra los cambios de A, porque son las mismas filas. |
| — | Pago por lote (`reservaManual.pagarLote`) | Precio → tabla | Pagar el lote de $10.000 marca pagado un número reservado en $3.000. |
| — | Reinicio (030) | Por tabla, protegiendo los sorteos activos por identidad | No borra lo activo de otro precio, pero archiva el histórico de **todos** los precios de esa tabla. |

Los únicos aislamientos que ya funcionan: la identidad de cada fila, el cierre por hora, el reemplazo por precio (sesión de sorteos) y la protección contra pagos duplicados.

### Medición
`backend/tests/reservas/aislamientoPorPrecio.test.js` recorre el código real con los dos sorteos:

| Modo | Resultado |
|---|---|
| Hoy (cuadrícula compartida) | 4 de 12 verificaciones correctas, **8 fallan por la cuadrícula compartida** (1, 2, 3, 4b, 4c, 5b, 6b, 8). |
| `TABLA_POR_PRECIO=1 ESTRICTO=1`: $10.000 con su propia tabla física, asignada **solo en `tablas_cliente`, sin tocar código** | **12 de 12.** |

## 3. Alternativas

**A. Tablas compartidas con el precio en cada fila.** Columna `precio` (o `cuadricula_id`), unicidad `(usuario_id, precio, numero)`, 100 filas por precio en la misma tabla, y un filtro por precio en cada lectura y escritura.

**B. Una tabla física por precio.** `tablas_cliente` apunta cada precio a su propia tabla. El código ya lee la cuadrícula a través de ese mapa.

| Criterio | A: precio en la fila | B: tabla por precio |
|---|---|---|
| **Integridad** | Un filtro olvidado mezcla precios **en silencio**. Hay unas 41 lecturas y escrituras en 23 archivos, más el frontend, las políticas RLS, los triggers y las RPC 027 y 030. | La separación es física: una consulta sin cambiar sigue aislada. Si un nombre de tabla falta en alguna lista, falla de forma **visible** (tabla no encontrada), no mezcla datos. |
| **Rendimiento** | Tablas N veces más grandes (≤ 8 precios × clientes × 100 filas: despreciable). Requiere índice `(usuario_id, precio, numero)`. | Igual o mejor: tablas pequeñas, índices actuales. Realtime solo envía lo de ese precio. |
| **Realtime** | El filtro de Supabase admite **una** columna (`usuario_id`): hay que filtrar el precio en el navegador, que recibe tráfico ajeno. | Sin cambios: cada vista se suscribe a su tabla. |
| **Complejidad de código** | Alta: todas las consultas, la RPC 027 (100 filas por precio), la 030 (reinicio por precio), el bot, el panel y los tipos. | Baja. Probado: los flujos de la prueba funcionan sin tocar código. Quedan listas fijas: `configEvento.js`, `filtroCliente.js` (comentario), `automation/repo/tablaEvento.js`, `frontend/lib/tablasConfig.ts` (lo usan `EventoCard`, `EventoTresCifrasCard` y `useContactos`) y `types.ts` (comentario). |
| **Migraciones** | Columna nueva, relleno de **todas** las filas históricas, cambio de la unicidad (033), RLS, función 027 y función 030. | Tablas nuevas `like … including all` + políticas RLS + `grant`s + triggers (inactividad 022, marcador 034, trigger heredado de compradores) + publicación Realtime + ampliar los `CHECK` y las listas de 027 y 030. **No modifica filas existentes.** |
| **Históricos** | Hay que **decidir el precio de cada fila antigua**. Por identidad se deduce, pero las filas sin identidad (manuales «sin sorteo», antiguas) son ambiguas: riesgo de atribuir un pago al precio equivocado. | Las filas antiguas se quedan donde están, con su identidad. Nada se reasigna. |
| **Compatibilidad** | Un backend o panel anterior sin el filtro mezcla precios mientras convivan versiones. | Un backend anterior sigue leyendo la tabla que diga `tablas_cliente`. Solo las listas fijas deben conocer las tablas nuevas. |
| **Reversión** | Difícil: los datos ya divididos por precio no vuelven a una sola fila. | Sencilla: volver a apuntar `tablas_cliente` a la tabla anterior (cuando ese precio no tenga sorteo activo). Las tablas nuevas se conservan. |
| **Riesgo sobre reservas y pagos** | Alto, por el relleno y la unicidad. | Bajo, si la transición se hace **por precio, sin sorteo activo** de ese precio. |

## 4. Recomendación: B, por fases (cada una con autorización)

1. **Diagnóstico de solo lectura (SQL, por preparar).** Por cliente y tabla compartida:
   - qué precios tienen sorteo activo;
   - cuántas filas reservadas o pagadas hay por identidad y precio;
   - cuántas no tienen identidad.

   Con eso se decide qué precio conserva cada tabla actual. La otra sesión propone $1.000 y $3.000.
2. **Migración 044 (por redactar y probar en PGlite):**
   - crear las 6 tablas que faltan con la misma estructura;
   - aplicarles las mismas políticas RLS, `grant`s, triggers y publicación Realtime;
   - ampliar los `CHECK` de `tablas_cliente` (027) y `reinicios_tabla` (030) y la lista de `reiniciar_tabla_cliente`.

   No cambia ninguna fila existente.
3. **Código:** actualizar las listas fijas y el mapa base (backend y panel), sin tocar los flujos de reserva y pago.
4. **Transición por cliente y precio, solo sin sorteo activo de ese precio:**
   - cambiar `tablas_cliente.tabla_fisica` del precio a su tabla nueva;
   - `inicializar_tablas_cliente` crea la cuadrícula 00–99 (ya lo hace para cada tabla que aparezca en `tablas_cliente`).
5. **Limpieza de la tabla compartida:** las reservas y pagos de otros precios que queden en ella seguirían contando en el precio que la conserva («una tabla = un sorteo»). Antes de su próximo sorteo, el administrador las revisa y, si corresponde, las archiva con el reinicio de la 030, que ya las guarda en `reservas_archivo`. **No se borra nada sin su decisión.**
6. **Verificación:** `TABLA_POR_PRECIO` deja de ser simulación, y `ESTRICTO=1 node backend/tests/reservas/aislamientoPorPrecio.test.js` debe dar 12 de 12.

**Hasta completar la fase 4:** no tener activos a la vez dos precios de la misma tabla física. Por ejemplo, $3.000 y $10.000, o $5.000 y $15.000. Con un solo precio activo por tabla física, todo lo anterior es correcto.

## 5. Decisiones pendientes del administrador

1. Alternativa A o B. Se recomienda B.
2. Qué precio conserva cada tabla actual, una vez visto el diagnóstico de la fase 1.
3. Qué hacer con las reservas o pagos de otros precios que queden en la tabla compartida: conservarlas como historia, archivarlas en el siguiente reinicio, o pagarlas o liberarlas antes.
4. El historial de números («Historial» del panel, perfil del contacto) de un precio que cambia de tabla: lo anterior seguirá visible en la tabla anterior. ¿Basta con eso o se quiere una vista unificada por identidad?

## 6. Qué no se tocó

- El pago por lote (la corrección del 01/11) sigue intacta.
- Los archivos de la sesión de sorteos (`unSorteoPorPrecio.js`, publicador, servicio, detector, 043 y sus pruebas): solo se **leen** desde la prueba de diagnóstico.
