# Pagos que fallan: `compradores_semanales.whatsapp` NOT NULL 🔐

**Estado:** diagnosticado. Arreglo preparado y probado en Postgres en memoria: **B1** en `parte_b_compradores_semanales.sql` (variante de la opción A que no necesita reescribir la función heredada). **No está aplicado** y requiere tu autorización.

## Qué pasa

1. Un cliente identificado **solo por LID** (sin teléfono conocido) reserva un número.
2. El administrador confirma el pago (sticker o panel). Ese UPDATE cambia `estado` a `'pagado'`.
3. Un **trigger heredado** de la base copia el pago a `compradores_semanales` y usa el teléfono de la fila (`contacto`/`telefono`) como `whatsapp`, que es **NOT NULL**.
4. Postgres responde `null value in column "whatsapp" of relation "compradores_semanales" violates not-null constraint` y **revierte el UPDATE entero**.

Consecuencias:
- el pago **no queda guardado**;
- el número sigue `reservado`;
- el sorteo no puede cerrarse por "todos pagados".

El trigger no está en el repositorio. La corrección de 2026-09 (`marcarReservasPagadasPorAdmin.js`) solo completa el teléfono **cuando existe**. Para un cliente solo LID no existe, y el código **no debe inventarlo**.

## Qué cambió en el código (local, sin desplegar)

- El error se reconoce (código `23502` + `compradores_semanales` + `whatsapp`) y se devuelve `motivo: "compradores_semanales_sin_whatsapp"`, con un log que explica la causa.
- La reserva no se toca y no se inventa ningún teléfono.
- Prueba: `backend/tests/pagos/compradoresSinWhatsapp.test.js`.

## Diagnóstico en la base (solo lectura, en el SQL Editor)

```sql
-- 1) Triggers sobre las tablas de reservas
select event_object_table as tabla, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras');

-- 2) Cuerpo de la función que escribe en compradores_semanales
select p.oid::regprocedure as funcion, pg_get_functiondef(p.oid) as definicion
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and pg_get_functiondef(p.oid) ilike '%compradores_semanales%';

-- 3) Cuántas reservas reservadas no tienen teléfono (riesgo actual)
select 'reservas_dos_cifras' as tabla, count(*) from public.reservas_dos_cifras
 where estado = 'reservado' and coalesce(nullif(contacto, ''), nullif(telefono, '')) is null
union all
select '5k_15k_reservas_2_cifras', count(*) from public."5k_15k_reservas_2_cifras"
 where estado = 'reservado' and coalesce(nullif(contacto, ''), nullif(telefono, '')) is null;
```

## Decisión que necesito

| Opción | Qué hace | Efecto |
|---|---|---|
| **A (recomendada)** | Al inicio de la función del trigger: `if coalesce(nullif(new.contacto,''), nullif(new.telefono,'')) is null then return new; end if;` | El pago se guarda. El cliente sin teléfono no suma a `compradores_semanales` (no hay con qué identificarlo). No se inventa nada. |
| B | `alter table public.compradores_semanales alter column whatsapp drop not null;` | El pago se guarda, pero se crean filas con `whatsapp` nulo que no se pueden agrupar por cliente. |
| C | No cambiar la base | Esos pagos siguen fallando; hay que confirmarlos cuando el cliente tenga teléfono. |

**Decisión preparada (B1):** en lugar de editar la función heredada (no está en el repositorio y su cuerpo no se puede leer por la API), un trigger `BEFORE INSERT` en `compradores_semanales` omite la fila cuando `whatsapp` es NULL.
- El efecto es el de la opción A: el pago se guarda, el cliente sin teléfono no suma y no se inventa nada.
- No depende del texto de la función: funciona con un `INSERT` simple y con un `INSERT ... ON CONFLICT`.
- La vuelta atrás es un `drop trigger`.
- Antes de aplicarlo, ejecuta las consultas `ANTES` del archivo. Si la función escribe con `UPDATE` en lugar de `INSERT`, avísame.

Datos reales (14/10, 13:40): hay **8** reservas «reservado» sin teléfono, solo con LID, en `reservas_dos_cifras` y **6** en `5k_15k_reservas_2_cifras`, todas del sorteo activo. Si el admin confirma esos pagos hoy, fallarán.
