// ==========================================================================
// Fake de Supabase para las pruebas del Automation Engine (Fase 2B).
//
// Aislado de fakeSupabaseSesiones.js / fakeSupabasePagos.js / fakeSupabase.js
// (identidad) — no comparte estado ni módulos con esas pruebas.
//
// Implementa el subconjunto de la API encadenable de supabase-js que usan
// backend/automation/{executionGuard,repo/eventSessions,repo/automationConfig}.js:
//
//   .from(tabla).select(...).eq(...).in(...).lt(...).order(...).limit(...)
//   .from(tabla).select(...).maybeSingle() / .single()
//   .from(tabla).insert(obj).select().single()
//   .from(tabla).update(obj).eq(...).select().single()
//
// Réplica fiel de las 2 restricciones UNIQUE reales de la migración 006:
//   - automation_actions: unique(clave_idempotencia)
//   - event_sessions:     unique(grupo_id, identidad_ciclo)
// Una violación se reporta como { error: { code: "23505", ... } }, igual
// que Postgres — mismo patrón que tests/pagos/fakeSupabasePagos.js.
//
// Sin `await` alguno antes de comprobar+escribir en insert(): dos llamadas
// concurrentes (Promise.all) se resuelven en el orden real de invocación,
// tal como Postgres serializa bajo el lock de la unique key — así el test
// de "dos ejecuciones concurrentes -> solo una ejecuta" es representativo,
// no un artefacto de la implementación del fake.
// ==========================================================================

const crypto = require("crypto");

const CODIGO_VIOLACION_UNICA_POSTGRES = "23505";

// Corrección quirúrgica Fase 2B: repo/eventSessions.js necesita distinguir
// la violación de UNIQUE(grupo_id, identidad_ciclo) de cualquier otro
// 23505 posible, mirando el texto del error (mensaje/`details`) — igual
// que haría Postgres real. Se replica aquí el formato real que produce
// Postgres para un `unique (a, b)` sin nombre explícito: constraint
// autogenerado "<tabla>_<col1>_<col2>_key", y un `details` del estilo
// "Key (col1, col2)=(v1, v2) already exists." Para las demás tablas se
// mantiene el mensaje genérico anterior — nada más las necesita.
function errorViolacionUnica(nombreTabla, fila) {

    if (nombreTabla === "event_sessions") {

        return {
            code: CODIGO_VIOLACION_UNICA_POSTGRES,
            message: 'duplicate key value violates unique constraint "event_sessions_grupo_id_identidad_ciclo_key"',
            details: `Key (grupo_id, identidad_ciclo)=(${fila.grupo_id}, ${fila.identidad_ciclo}) already exists.`
        };

    }

    return {
        code: CODIGO_VIOLACION_UNICA_POSTGRES,
        message: `duplicate key value violates unique constraint en "${nombreTabla}"`
    };

}

function crearFakeSupabaseAutomation() {

    const tablas = {
        event_sessions: [],
        automation_actions: [],
        automation_configs: [],
        grupos_autorizados: [],
        // Fase 3: tabla EXISTENTE (no una de las 4 nuevas de 006) — se
        // agrega aquí para que las pruebas de integración de
        // detectarEvento.js puedan ejercitar guardarEvento()/
        // consultarEvento() reales (sin cambiarlos) contra un Supabase
        // fake, igual que las otras 4. Nunca se le aplica chocaUnicidad
        // (guardarEvento.js decide "crear vs actualizar" leyendo
        // consultarEvento() primero, no vía un constraint de BD).
        eventos_bot: [],
        // Fase 4A (migración 007) — Message Pool y su registro de uso.
        automation_messages: [],
        automation_message_uses: [],
        // Fase 4B: tabla EXISTENTE (002_reservas_actividad.sql, ninguna
        // relación con 006/007) — se agrega aquí, igual que eventos_bot en
        // Fase 3, para que repo/reservasActividad.js (solo lectura) pueda
        // probarse contra el mismo fake sin crear uno nuevo.
        reservas_actividad: [],
        // Fase 5 (INITIAL_TABLE): una de las tablas de reservas reales que
        // evento.tabla puede nombrar (ver bot/funciones/eventos/
        // configEvento.js) — se agrega aquí, mismo criterio que
        // reservas_actividad, para que repo/tablaEvento.js (solo lectura)
        // pueda probarse contra el mismo fake.
        reservas_dos_cifras: []
    };

    // Corrección quirúrgica Fase 2B: para probar "otro error de Supabase
    // distinto de 23505 sigue siendo un error real" hace falta poder
    // forzar un error arbitrario en el PRÓXIMO insert de una tabla —
    // ningún escenario real del fake produce hoy otro tipo de error. Se
    // consume una sola vez (se borra al usarse), para no afectar el resto
    // de la prueba.
    const forzarErrorInsert = new Map(); // nombreTabla -> error

    function filasDe(nombre) {

        if (!(nombre in tablas)) {
            throw new Error(`fakeSupabaseAutomation: tabla no soportada "${nombre}"`);
        }

        return tablas[nombre];

    }

    function idNuevo() {
        return crypto.randomUUID();
    }

    function chocaUnicidad(nombreTabla, fila, filasExistentes) {

        if (nombreTabla === "automation_actions") {

            return filasExistentes.some(f => f.clave_idempotencia === fila.clave_idempotencia);

        }

        if (nombreTabla === "event_sessions") {

            return filasExistentes.some(f =>
                f.grupo_id === fila.grupo_id &&
                f.identidad_ciclo === fila.identidad_ciclo
            );

        }

        if (nombreTabla === "automation_configs") {

            return filasExistentes.some(f =>
                f.usuario_id === fila.usuario_id &&
                f.grupo_id === fila.grupo_id
            );

        }

        if (nombreTabla === "grupos_autorizados") {

            return filasExistentes.some(f =>
                f.usuario_id === fila.usuario_id &&
                f.grupo_id === fila.grupo_id
            );

        }

        return false;

    }

    function crearQuery(nombreTabla) {

        let modo = null; // 'select' | 'insert' | 'update'
        let payload = null;
        const filtrosEq = [];
        const filtrosIn = [];
        const filtrosLt = [];
        const filtrosGte = [];
        const filtrosIs = [];
        let ordenCampo = null;
        let ordenAsc = true;
        let limiteN = null;

        function coincide(fila) {

            return filtrosEq.every(([c, v]) => fila[c] === v) &&
                filtrosIn.every(([c, vs]) => vs.includes(fila[c])) &&
                filtrosLt.every(([c, v]) => fila[c] !== undefined && fila[c] !== null && fila[c] < v) &&
                filtrosGte.every(([c, v]) => fila[c] !== undefined && fila[c] !== null && fila[c] >= v) &&
                // .is(col, null) -> IS NULL real de Postgres (nunca "= null",
                // que en SQL jamás es true) — fiel al supabase-js real, ver
                // repo/messages.js (obtenerMensajesActivos: usuario_id null =
                // mensaje GLOBAL).
                filtrosIs.every(([c, v]) => (v === null ? (fila[c] === null || fila[c] === undefined) : fila[c] === v));

        }

        const builder = {

            select(_cols) {
                if (modo === null) modo = "select";
                return builder;
            },

            insert(obj) {
                modo = "insert";
                payload = obj;
                return builder;
            },

            update(obj) {
                modo = "update";
                payload = obj;
                return builder;
            },

            eq(campo, valor) {
                filtrosEq.push([campo, valor]);
                return builder;
            },

            in(campo, valores) {
                filtrosIn.push([campo, valores]);
                return builder;
            },

            is(campo, valor) {
                filtrosIs.push([campo, valor]);
                return builder;
            },

            lt(campo, valor) {
                filtrosLt.push([campo, valor]);
                return builder;
            },

            gte(campo, valor) {
                filtrosGte.push([campo, valor]);
                return builder;
            },

            order(campo, opts) {
                ordenCampo = campo;
                ordenAsc = !opts || opts.ascending !== false;
                return builder;
            },

            limit(n) {
                limiteN = n;
                return builder;
            },

            async single() {

                const r = ejecutar();

                if (r.error) return r;

                const datos = Array.isArray(r.data) ? r.data : [r.data].filter(Boolean);

                if (datos.length !== 1) {
                    return { data: null, error: { message: `single(): ${datos.length} filas coincidentes (se esperaba 1)` } };
                }

                return { data: datos[0], error: null };

            },

            async maybeSingle() {

                const r = ejecutar();

                if (r.error) return r;

                const datos = Array.isArray(r.data) ? r.data : [r.data].filter(Boolean);

                return { data: datos.length ? datos[0] : null, error: null };

            },

            then(onFulfilled, onRejected) {
                return Promise.resolve(ejecutar()).then(onFulfilled, onRejected);
            }

        };

        // SÍNCRONA a propósito (ver cabecera): el chequeo de unicidad y la
        // escritura ocurren en el mismo tick, sin ningún `await` de por
        // medio, para que dos inserts "concurrentes" (invocados vía
        // Promise.all antes de que ninguno haya podido completar) se
        // resuelvan en orden de invocación real, igual que el lock de fila
        // de Postgres.
        function ejecutar() {

            const filas = filasDe(nombreTabla);

            if (modo === "select") {

                let resultado = filas.filter(coincide).map(f => ({ ...f }));

                if (ordenCampo) {

                    resultado = [...resultado].sort((a, b) => {

                        if (a[ordenCampo] === b[ordenCampo]) return 0;

                        const mayor = a[ordenCampo] > b[ordenCampo];

                        return ordenAsc ? (mayor ? 1 : -1) : (mayor ? -1 : 1);

                    });

                }

                if (limiteN != null) resultado = resultado.slice(0, limiteN);

                return { data: resultado, error: null };

            }

            if (modo === "insert") {

                if (forzarErrorInsert.has(nombreTabla)) {

                    const error = forzarErrorInsert.get(nombreTabla);
                    forzarErrorInsert.delete(nombreTabla); // se consume una sola vez

                    return { data: null, error };

                }

                const ahora = new Date().toISOString();

                const fila = {

                    id: idNuevo(),
                    creado_en: ahora,
                    actualizado_en: ahora,
                    ...payload

                };

                if (chocaUnicidad(nombreTabla, fila, filas)) {

                    return {
                        data: null,
                        error: errorViolacionUnica(nombreTabla, fila)
                    };

                }

                filas.push(fila);

                // Fase 3: real supabase-js devuelve un ARRAY en
                // `.insert(x).select()` SIN `.single()` (guardarEvento.js
                // usa exactamente ese patrón: `resultado.data[0]`). `.single()`
                // /`.maybeSingle()` ya normalizan un array o un objeto suelto
                // por igual (ver más abajo), así que este cambio no afecta a
                // ningún llamador existente que sí encadene `.single()`.
                return { data: [fila], error: null };

            }

            if (modo === "update") {

                const actualizadas = [];

                for (let i = 0; i < filas.length; i++) {

                    if (coincide(filas[i])) {

                        filas[i] = { ...filas[i], ...payload };
                        actualizadas.push(filas[i]);

                    }

                }

                return { data: actualizadas, error: null };

            }

            return { data: null, error: { message: `fakeSupabaseAutomation: modo no soportado (${modo})` } };

        }

        return builder;

    }

    const client = {

        from(nombreTabla) {
            return crearQuery(nombreTabla);
        }

    };

    return {

        client,

        _tablas: tablas,
        _filas: (nombre) => filasDe(nombre),

        // Consumido una sola vez (ver declaración arriba) — solo para
        // probar que un error de Supabase que NO es la violación de
        // unicidad esperada sigue propagándose tal cual.
        _forzarErrorInsert(nombreTabla, error) {
            forzarErrorInsert.set(nombreTabla, error);
        },

        _agregar(nombreTabla, fila) {

            const ahora = new Date().toISOString();

            const completa = { id: idNuevo(), creado_en: ahora, actualizado_en: ahora, ...fila };

            filasDe(nombreTabla).push(completa);

            return completa;

        }

    };

}

module.exports = { crearFakeSupabaseAutomation };
