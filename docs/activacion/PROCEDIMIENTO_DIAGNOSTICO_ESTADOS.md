# Procedimiento: diagnóstico de estados contradictorios (F2)

Preparado el 06/11/2026. **No ejecutado.** Necesita tu autorización expresa. Es la única operación de este documento que toca la base, y es de **solo lectura**.

## 1. Qué es y qué no es

- **Es:** la consulta [`estado_sorteos_contradicciones_solo_lectura.sql`](estado_sorteos_contradicciones_solo_lectura.sql). Son tres `SELECT` dentro de `begin; set transaction read only; … rollback;` y no crea ningún objeto. Está validada en local contra `estadosGestion.js` (`backend/tests/caracterizacion/estadoSorteosSqlReal.test.js`).
- **No es una reparación.** No cambia ninguna fila. Lo que se decida después se hace en F3 (acciones) o F4 (datos), con su propia autorización.
- **No devuelve datos personales:** ni compradores, ni teléfonos, ni nombres de grupo, ni textos.

## 2. Antes de ejecutar

1. Autorización escrita para ejecutar **este** archivo en **este** proyecto de Supabase.
2. Comprobar que el archivo es el del repositorio, sin cambios locales: `git diff --stat -- docs/activacion/estado_sorteos_contradicciones_solo_lectura.sql` no debe mostrar nada.
3. Abrir el SQL Editor del proyecto correcto. Ojo: el proyecto se comparte con otras aplicaciones.

## 3. Ejecutar

1. Pegar el archivo **completo**, del `begin;` al `rollback;`.
2. Ejecutar una sola vez.
3. El editor muestra tres resultados. Exportar cada uno a CSV o copiarlo.
4. Si aparece un error, **no** reintentar con cambios: anotar el mensaje y parar.

## 4. Qué anotar (plantilla)

**Resultado 1. Resumen global**

| Columna | Valor | Qué significa |
|---|---|---|
| `filas` | | total de filas de `eventos_bot` |
| `vigentes_canonico` | | sorteos en curso según la fuente única |
| `en_curso_criterio_c` | | lo que hoy muestra Eventos como «En curso» |
| `abiertas_criterio_b` | | lo que hoy tratan como abierto Sorteos programados y edición |
| `activo_true_ya_cerrado` | | **casos C3** |
| `activo_null` | | **casos NULL** |
| `regla1_dejan_de_aceptar_reservas` | | filas en las que, desde F2, el bot ya no acepta reservas nuevas |
| `regla2_sin_recordatorios` | | filas que, desde F2, ya no reciben recordatorios |
| `regla4_panel_pasa_a_cerrado` | | filas que el panel ya muestra «Cerrado» desde F2 |
| `pendiente_f3_en_curso_en_eventos` | | filas que siguen «En curso» en Eventos hasta F3 |

**Resultado 2. Por cliente:** una fila por `usuario_id` con casos. Anotar cuántos clientes y cuántos casos tienen `con_numeros_tomados > 0`.

**Resultado 3. Casos:** guardar la lista completa. Para cada caso, anotar a qué grupo de §5 pertenece.

## 5. Cómo leer cada caso y qué hacer después

| Grupo | Cómo se reconoce | Riesgo hoy | Qué se propone (cada uno necesita autorización) |
|---|---|---|---|
| **C3 sin números** | `contradiccion = activo_terminado`, `reservados + pagados = 0` | Eventos lo muestra «En curso»; ya no recibe reservas ni recordatorios | Repararlo con la operación de F3 «normalizar cierre» (sin aviso). Prioridad baja |
| **C3 con números** | igual, con `reservados` o `pagados > 0` | Sus números están en una tabla que puede ser ya la de otro sorteo. **No** ocupa el precio: la restricción de la 043 ya la excluye (`cierre_estado = 'cerrado'` o motivo `panel:`/`sustituido`) | Repararlo en F3 sin tocar sus números. Antes, confirmar con el cliente qué pasó |
| **C3 con ciclo en curso** | `ciclos_en_curso > 0` | Su ciclo de automatización no termina: el paso 1b de F2 lo deja sin envíos, pero abierto | F3: la normalización cierra el ciclo **sin** aviso de cierre |
| **C3 con programación** | `grupos_programados > 0` | El estado operativo de Sorteos programados puede contradecir a Eventos | F3, junto con la programación |
| **NULL sin números** | `contradiccion = activo_sin_valor`, contadores en 0 | Ninguno desde F2 (cerrado en todas partes) | F4: `activo = false` y `NOT NULL` en la columna |
| **NULL con números** | igual, con contadores > 0 | El reinicio de tabla (030) **protege** esa tabla y no la reinicia | No tocar sin decidir qué pasa con esas reservas. Son legítimas mientras no se decida otra cosa |

Reglas:

- Una reserva o un pago existente **nunca** se libera ni se borra por este diagnóstico ni por su reparación.
- Ninguna reparación se hace con un `UPDATE` a mano en el editor. Si hiciera falta, se prepara como script revisado y autorizado (F4).

## 6. Después

- Pegar los tres resultados (sin datos personales) en la revisión de F2.
- Con `activo_true_ya_cerrado = 0` y `activo_null = 0`, el conflicto de la regla 5 en las pantallas de administración no tiene efecto. F3 puede cambiar las acciones sin riesgo visible.
- En cualquier otro caso, F3 debe incluir la operación «normalizar cierre» antes de pasar las pantallas al criterio canónico ([`../arquitectura/F3_CIERRE_REAPERTURA.md`](../arquitectura/F3_CIERRE_REAPERTURA.md)).

**Actualización F3 (06/11/2026, en local, sin desplegar):** la operación «normalizar cierre» ya existe: «Cerrar» o «Desactivar» sobre una fila C3 desde Eventos la normaliza sin WhatsApp ni aviso (`cerrarEvento.normalizarCierre`). Este diagnóstico sigue diciendo cuántas hay; la reparación sigue necesitando autorización, fila a fila desde el panel o con un script revisado (F4).

## 7. Segunda consulta: estado operativo de los cierres (F3)

Preparada el 06/11/2026. **No ejecutada.** Igual que la primera: solo lectura, autorización expresa y el archivo sin cambios locales (`git diff --stat -- docs/activacion/estado_cierres_f3_solo_lectura.sql`).

- **Archivo:** [`estado_cierres_f3_solo_lectura.sql`](estado_cierres_f3_solo_lectura.sql). Funciona con o sin las migraciones 023, 047 y 048, porque lee las columnas opcionales con `to_jsonb(fila)`. Se validó en local (PGlite) sobre una base sin ellas y otra con todas; los datos quedan intactos.
- **Devuelve cinco resultados:**

| Resultado | Qué anotar | Cómo leerlo |
|---|---|---|
| 1. Migraciones | `migracion_047_reservas_modo`, `migracion_048_historial`, `migracion_023_cierre` | Sin 047: todo «según el estado» y el panel avisa al cambiar el permiso. Sin 048: el historial va al log |
| 2. Cierres pendientes | `manual_whatsapp_pendiente`, `manual_whatsapp_abandonado`, `automatico_fallido`, `automatico_requiere_revision`, `normalizadas` | Pendiente: el reintento del worker lo resuelve solo. Abandonado (10 intentos): revisar permisos del número en ese grupo. Automático fallido o en revisión: el sorteo sigue aceptando reservas hasta que WhatsApp confirme |
| 3. Registro `CIERRE_GRUPO` | acciones por estado, `en_progreso_vencidas`, `retiradas_por_reapertura`, `max_intentos` | Solo existe tras desplegar el endurecimiento. Un `en_progreso` vencido (más de 5 min) lo retoma el siguiente cierre; muchos seguidos indican caídas del proceso |
| 4. Permiso distinto entre grupos | sorteos con más de un modo | Solo puede venir de filas anteriores al endurecimiento (los grupos nuevos heredan el permiso). Se corrige volviendo a elegir el permiso en el panel |
| 5. Casos | la lista completa | Sin datos personales: ids, estados, intentos y el error recortado |

Reglas: lo mismo que §5. Nada se repara desde el editor.
