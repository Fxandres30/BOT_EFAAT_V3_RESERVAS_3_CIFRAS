# Reservas de un sorteo ya cerrado («huérfanas») 🔐

**Estado:** diagnosticado el 2026-10-14 con consultas de solo lectura. Nada aplicado.

## Situación real (14/10, ~13:40 hora Bogotá)

- `reservas_dos_cifras`: **0** filas reservadas o pagadas de otro sorteo. El caso de «68 pagados + 17 reservados» que recogía `ACTIVACION.md` ya no existe: la tabla pertenece entera al sorteo activo (Sinuano Día).
- `5k_15k_reservas_2_cifras`: **6** filas reservadas de sorteos **ya jugados**:

| id | número | estado actual | sorteo de origen (identidad) | qué dice la actividad |
|---|---|---|---|---|
| 22334 | 12 | reservado | Antioqueñita Día 10:00, $3.000, 14/10 (`68e28a19`) | reservado 09:55, sin pago |
| 22346 | 24 | reservado | ídem | reservado 07:33, **pagado 09:31** por sticker |
| 22365 | 43 | reservado | ídem | reservado 05:11, **pagado 09:08** por sticker |
| 22383 | 61 | reservado | ídem | reservado 08:26, **pagado 08:32** por sticker |
| 22387 | 65 | reservado | ídem | reservado 09:31, sin pago |
| 22408 | 86 | reservado | Lotería Cruz Roja 22:30, $5.000, 13/10 (`14aed347`) | pagado 13/10 20:20; sin fechas ni evento |

(Horas en hora Bogotá. La identidad se calculó con `crearIdentidadEventoReal` sobre `event_sessions.datos_evento_snapshot`.)

## Efecto en el sorteo de esta noche (Lotería de Manizales, $5.000)

`sorteoReal.js` las clasifica como `ocupado_otro_sorteo`:
- esos 6 números **no se pueden vender** esta noche;
- el sorteo **nunca puede cerrarse por «todos pagados»** (máximo 94/100) y se cierra solo por hora;
- `sorteos/disponibilidad.js` bloquearía publicar un sorteo programado en esa tabla.

## ⚠️ Anomalía que hay que investigar antes de tocar nada

Los números **24, 43 y 61** tienen `fecha_pago`/`hora_pago` de hoy, que coinciden al segundo con la confirmación del administrador. Esa actividad solo se registra si el UPDATE devolvió filas (`marcarReservasPagadasPorAdmin.js`). Aun así, su estado actual es **reservado**. El número 86 está «reservado» con teléfono pero sin evento ni fechas, aunque el reinicio de las 00:21 vacía esos campos.

**Ningún código de este repositorio** pasa una fila de `pagado` a `reservado`: `reservarNumeros.js` solo toma filas `libre`, y el panel solo pasa a `libre`, `en_proceso` o `pagado`. Algo externo escribe en la tabla. Candidatos:
1. una aplicación con la clave **anon**: hoy anon tiene permiso de escritura y RLS está desactivado;
2. una edición manual en el Table Editor de Supabase;
3. un trigger o tarea `pg_cron` heredados.

Consultas de solo lectura (SQL Editor):

```sql
-- triggers de las tablas de reservas (cualquier BEFORE UPDATE que cambie NEW.estado)
select c.relname, t.tgname, pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where c.relname in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras') and not t.tgisinternal;

-- tareas programadas (si pg_cron está instalado; si da error, no lo está)
select jobid, schedule, command, active from cron.job;

-- otras filas "reservado" que ya tuvieron pago (indicio de la misma anomalía)
select 'reservas_dos_cifras' as tabla, id, numero, fecha_pago, hora_pago from public.reservas_dos_cifras
 where estado = 'reservado' and fecha_pago is not null and hora_pago >= hora_reserva and fecha_pago >= fecha_reserva
union all
select '5k_15k_reservas_2_cifras', id, numero, fecha_pago, hora_pago from public."5k_15k_reservas_2_cifras"
 where estado = 'reservado' and fecha_pago is not null and hora_pago >= hora_reserva and fecha_pago >= fecha_reserva;
```

En **Supabase → Logs → API**, filtra peticiones `PATCH` a `/rest/v1/5k_15k_reservas_2_cifras` entre las 08:30 y las 10:00 (hora Bogotá) del 14/10. El rol (`anon`, `authenticated` o `service_role`) y el *user agent* dirán quién fue. La Parte A (RLS) cerraría la vía 1.

## Propuesta (sin borrar ni reiniciar tablas)

**R0 — Nada hasta saber quién revierte pagos.** Si fue un escritor externo, puede volver a hacerlo con cualquier número.

**R1 — Archivar las 6 filas** (solo inserta en una tabla nueva; no cambia reservas). Conserva la prueba de pago de 24, 43 y 61 antes del reinicio nocturno habitual, que vacía `fecha_pago`.

```sql
begin;

create table if not exists public.reservas_archivo (
    id bigint generated always as identity primary key,
    archivado_en timestamptz not null default now(),
    motivo text not null,
    tabla text not null,
    fila_id bigint not null,
    fila jsonb not null
);
alter table public.reservas_archivo enable row level security;  -- sin políticas: solo service_role
revoke all on table public.reservas_archivo from anon, authenticated;

-- Reservadas/pagadas cuya identidad no es la de ningún evento ACTIVO de esa tabla y tenant.
insert into public.reservas_archivo (motivo, tabla, fila_id, fila)
select 'reserva de sorteo cerrado (2026-10-14)', '5k_15k_reservas_2_cifras', r.id, to_jsonb(r)
from public."5k_15k_reservas_2_cifras" r
where r.estado in ('reservado', 'pagado')
  and not exists (
      select 1 from public.eventos_bot e
      where e.activo and e.tabla = '5k_15k_reservas_2_cifras'
        and e.usuario_id = r.usuario_id
        and e.identidad_evento_real is not distinct from r.identidad_evento_real
  );

-- Debe decir 6 (ids 22334, 22346, 22365, 22383, 22387, 22408). Si no, ROLLBACK.
select count(*), array_agg(fila_id order by fila_id) from public.reservas_archivo
where motivo = 'reserva de sorteo cerrado (2026-10-14)';

commit;
```
Riesgo: ninguno para el sorteo activo. Vuelta atrás: `drop table public.reservas_archivo;`.

**R2 — Liberar solo esas filas** (opcional, después de R1 y con tu decisión). Pone a `libre` exactamente esas 6 filas, igual que el botón «Liberar» del panel, con guardias de estado e identidad, y deja actividad. **Cuándo:** después del cierre de esta noche y antes del siguiente anuncio en esa tabla. Si se hace antes, los 6 números se venden esta noche.

```sql
begin;

with liberadas as (
    update public."5k_15k_reservas_2_cifras" r
    set estado = 'libre', comprador = null, contacto = null, contacto_lower = null, lib = null,
        grupo_id = null, grupo_nombre = null, evento_id = null, nombre_evento = null, telefono_bot = null,
        fecha_reserva = null, hora_reserva = null, fecha_pago = null, hora_pago = null,
        temporal_por = null, bloqueado_hasta = null, ip_reserva = null,
        usuario_global_id = null, nombre = null, telefono = null
    from public.reservas_archivo a
    where a.motivo = 'reserva de sorteo cerrado (2026-10-14)'
      and a.tabla = '5k_15k_reservas_2_cifras'
      and r.id = a.fila_id
      and r.estado = a.fila->>'estado'                                        -- no cambió desde R1
      and r.identidad_evento_real is not distinct from a.fila->>'identidad_evento_real'
    returning r.id, r.numero, r.usuario_id
)
insert into public.reservas_actividad (usuario_id, tabla, numero, evento_id, tipo, detalle, realizado_por)
select usuario_id, '5k_15k_reservas_2_cifras', numero, null, 'liberado',
       jsonb_build_object('motivo', 'reserva de sorteo cerrado', 'archivo', 'reservas_archivo'), 'admin_sql'
from liberadas;

-- Debe ser 6. Si no, ROLLBACK.
select count(*) from public.reservas_actividad where realizado_por = 'admin_sql' and creado_en > now() - interval '1 minute';

commit;
```
Riesgo: si un cliente de esas filas creía tener el número para otro sorteo, lo pierde (son sorteos ya jugados). Vuelta atrás: restaurar desde `reservas_archivo` con `jsonb_populate_record`, por id.

**Alternativa sin SQL:** el reinicio nocturno que ya haces desde el panel (`tabla_reiniciada`, hoy a las 00:21) libera esas filas igualmente. Haz **R1 antes** para no perder la prueba de los 3 pagos.
