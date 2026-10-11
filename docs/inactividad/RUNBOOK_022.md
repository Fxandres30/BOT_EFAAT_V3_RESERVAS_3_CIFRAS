# Control de inactividad — procedimiento de migración y simulación (fase 022)

Este procedimiento cubre la fase de **migración + simulación**. Las expulsiones reales permanecen **desactivadas** durante toda la fase. Cada bloque marcado 🔐 requiere tu autorización explícita antes de ejecutarlo.

Archivos de apoyo, todos en `docs/inactividad/`:
- `022_verificacion.sql`: comprobaciones tras aplicar la migración. Solo lectura.
- `revision_simulacion.sql`: revisión de candidatos, excluidos, identidades y pago de prueba. Solo lectura.

---

## 0. Garantías de esta fase (cómo se impide expulsar)

| Capa | Qué la impide |
|---|---|
| Entorno | Sin variables, el modo es `simulacion`. Para el modo real hacen falta **las dos**: `INACTIVIDAD_MODO=real` **y** `INACTIVIDAD_CONFIRMAR_EXPULSIONES=SI`. Con una sola, se degrada a simulación y lo avisa en el log. |
| Código | Solo hay **una** llamada de expulsión en el módulo (`expulsar()` en `ejecutarControlInactividad.js`). Justo antes, se **vuelve a leer el entorno**, sin importar la configuración que reciba la ejecución. Hay una prueba estática (n.º 43) que lo vigila. |
| Freno de emergencia | `INACTIVIDAD_MODO=desactivado` y reiniciar: el worker no arranca. |

La simulación **sí escribe** en las tablas nuevas (`inactividad_*`): crea el seguimiento y la bitácora. También consulta a WhatsApp los participantes de cada grupo comercial una vez al día, a través de la cola de IQ con espaciado. No escribe en ninguna otra tabla ni envía mensajes.

---

## 1. Antes de empezar

1. Revisa el diff (`git status`, `git diff`) y, si te parece bien, haz el commit tú. 🔐
2. Haz una copia de seguridad o anota los triggers actuales de las tablas de reservas para compararlos después (V8). En el SQL Editor:
   ```sql
   select event_object_table, trigger_name, event_manipulation
   from information_schema.triggers
   where event_object_table in ('reservas_dos_cifras', '5k_15k_reservas_2_cifras')
   order by 1, 2, 3;
   ```

## 2. Aplicar la migración 🔐

1. Supabase → SQL Editor → pega **todo** `backend/supabase_migrations/022_control_inactividad_miembros.sql` → Run.
2. Debe terminar sin errores. Puede mostrar `NOTICE` si una tabla de reservas no existe.
3. Pega `docs/inactividad/022_verificacion.sql` → Run, y compara cada resultado con su `ESPERADO`:
   - V1: 3 tablas, todas con `rls = true`.
   - V3: ninguna fila para `anon` ni `authenticated`.
   - V5: **4** filas.
   - V6: `security_definer = true`.
   - V7: `false` / `false`.
   - V8: los triggers anotados en el paso 1.2, más el nuevo.
   - V10: `importables = importados`.
   - V11: 0 filas.
4. **Si algo no coincide: no despliegues el backend.** Usa la reversión mínima (sección 7).

> La migración no necesita el backend nuevo para funcionar: desde ese momento, todo pago (del panel o por sticker) queda registrado por el trigger.

## 3. Variables de entorno (en **cada** instancia que pueda ejecutar el bot: VPS y LOCAL, por el lease)

En `backend/.env`:

```dotenv
# Control de inactividad — FASE DE SIMULACIÓN
INACTIVIDAD_MODO=simulacion
# NO definir INACTIVIDAD_CONFIRMAR_EXPULSIONES en esta fase.

# Opcional: empezar con un solo grupo (JID completo). Sin ella, evalúa
# todos los grupos con sorteos (eventos_bot) del tenant.
# INACTIVIDAD_GRUPOS=1203630xxxxxxxxx@g.us

# Opcional: teléfonos (con 57) o LIDs que nunca se evalúan, separados por coma.
# INACTIVIDAD_PROTEGIDOS=57300xxxxxxx,57310xxxxxxx
```

Valores por defecto (no hace falta definirlos):
- `INACTIVIDAD_DIAS=15`
- `INACTIVIDAD_HORA_BOGOTA=10`
- `INACTIVIDAD_INTERVALO_MS=3600000`
- `INACTIVIDAD_HORAS_ENTRE_EJECUCIONES=20`
- `INACTIVIDAD_MAX_EXPULSIONES=10`
- `INACTIVIDAD_REINTENTOS=2`
- `INACTIVIDAD_LOCK_MINUTOS=120`
- `INACTIVIDAD_RETENCION_DIAS=90`
- `DISPONIBILIDAD_VENTANA_USUARIO_MS=30000`
- `DISPONIBILIDAD_VENTANA_GRUPO_MS=8000`
- `DISPONIBILIDAD_EN_CURSO_MAX_MS=60000`

⚠️ `dotenv` **no sobrescribe** variables que PM2 ya inyecte (ecosystem o `pm2 set`). Por eso hay que comprobarlas en el paso 4.3.

## 4. Desplegar y reiniciar PM2 🔐

```bash
# 4.1 En el servidor, dentro del repositorio
git pull                       # o el método de despliegue habitual
cd backend && npm ci --omit=dev && cd ..   # solo si cambiaron dependencias (esta fase no añade ninguna)

# 4.2 Identificar el proceso
pm2 ls                         # anota el nombre o id del backend (<APP>)

# 4.3 Comprobar que NINGUNA variable de PM2 habilita expulsiones
pm2 env <APP> | grep -E "INACTIVIDAD|DISPONIBILIDAD"
#   NO debe aparecer INACTIVIDAD_CONFIRMAR_EXPULSIONES ni INACTIVIDAD_MODO=real.
grep -E "^INACTIVIDAD|^DISPONIBILIDAD" backend/.env
#   Debe mostrar INACTIVIDAD_MODO=simulacion y nada más relacionado con expulsiones.

# 4.4 Reiniciar con el entorno actualizado
pm2 restart <APP> --update-env

# 4.5 Confirmar el arranque en modo simulación
pm2 logs <APP> --lines 200 | grep -E "INACTIVIDAD|SESSION ACTIVE"
#   Esperado:  🧹 [INACTIVIDAD] worker iniciado para <sessionId> (modo simulacion, cada 3600000ms)
#   Si aparece "modo real": pm2 stop <APP> y revisar el entorno.
```

Si existe una segunda instancia (LOCAL), repite 4.3 a 4.5 en ella **antes** de que pueda tomar el lease.

## 5. Pago de prueba (comprobar el registro persistente de compras)

Usa un grupo y un cliente de prueba (un número propio).

1. Desde ese número, reserva un número en el grupo de prueba.
2. `revision_simulacion.sql` → **P1** (con el teléfono sin 57) → anota `usuario_global_id`.
3. **P2** → anota el estado actual.
4. Confirma el pago **por una vía**:
   - **Panel:** Tablas → número → "Marcar pagado".
   - **Sticker:** un administrador responde (cita) el mensaje del cliente con el sticker de pago configurado.
5. **P3**. Esperado:
   - En el grupo de la reserva, `ultima_compra_en` coincide con la hora del pago (`hace` < 1 min).
   - `ultima_compra_origen` es `trigger_pago` (con el sticker también puede ser `sticker_admin`).
   - La fila de la reserva figura como `pagado`.
6. Persistencia: reinicia la tabla desde el panel (solo si es de pruebas) y vuelve a ejecutar P3. **`ultima_compra_en` debe seguir igual.**
7. Repite con la otra vía de pago.
8. Si P3 no cambió: revisa en Supabase → Logs → Postgres si hay un `WARNING` `inactividad_registrar_compra`. El pago no se bloquea; solo no quedó registrado.

## 6. Revisar la simulación

La primera evaluación ocurre en el primer tick del worker (≤ 1 h desde el arranque), una vez pasadas las 10:00 de Bogotá. Después, como mucho una vez cada 20 h.

1. Logs: `pm2 logs <APP> --lines 500 | grep -A60 "CONTROL DE INACTIVIDAD"`. Los JIDs aparecen enmascarados.
2. `revision_simulacion.sql`:
   - **R1:** modo `simulacion`, estado `completada`.
   - **R2:** **las tres cifras en 0** (control de seguridad).
   - **R3:** reparto por decisión y motivo.
   - **R4:** candidatos. Valida 3 a 5 con **R9**: ¿de verdad no compraron en ese grupo en 15 días?
   - **R5:** excluidos. ¿Están todos los admins, el dueño y el bot?
   - **R6:** omitidos. Si `identidad_incompleta` es alto, esas personas **nunca** serán expulsadas hasta que el escáner vincule su LID con su teléfono.
   - **R7:** 0 grupos con error.
   - **R8:** próximos a cumplir el plazo.
3. Nadie que nunca compró puede ser candidato antes de 15 días desde la primera ejecución. Quien ya tenía compras importadas sí puede serlo desde el primer día.
4. Mantén la simulación **al menos 15 días** antes de plantear el modo real, que requerirá una autorización y un procedimiento propios.

## 7. Reversión 🔐

**Reversión mínima** (preferida: detiene la captura y conserva el historial):
```sql
drop trigger if exists inactividad_compra_confirmada on public.reservas_dos_cifras;
drop trigger if exists inactividad_compra_confirmada on public."5k_15k_reservas_2_cifras";
```
Y en el backend: `INACTIVIDAD_MODO=desactivado` + `pm2 restart <APP> --update-env`.

**Reversión completa** (borra el historial del control): el bloque `REVERSIÓN` al final de la migración 022.

Ninguna de las dos toca datos de reservas, pagos, usuarios ni eventos.
