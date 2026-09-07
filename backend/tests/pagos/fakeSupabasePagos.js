// ==========================================================================
// Fake de Supabase para las pruebas del módulo de pagos P1.
//
// Aislado de fakeSupabaseSesiones.js / fakeSupabase.js (identidad) — no
// comparte estado ni módulos con esas pruebas.
//
// Implementa el subconjunto de la API encadenable de supabase-js que usan
// backend/pagos/autenticacionDispositivo.js y backend/pagos/pagosController.js:
//
//   .from("pagos_dispositivos").select(...).eq(...).maybeSingle()
//   .from("pagos_dispositivos").insert(obj).select().single()
//   .from("pagos_dispositivos").update(obj).eq(...)
//   .from("pagos_movimientos").insert(obj).select().single()
//   .from("pagos_movimientos").select(...).eq(...).neq(...).maybeSingle()
//   .from("pagos_movimientos").select(...).eq(...).order(...).limit(...)
//
// Réplica fiel del índice único parcial real de la migración 005:
//   unique (usuario_id, hash_duplicado) WHERE estado <> 'duplicado'
// Una violación se reporta como { error: { code: "23505", ... } }, igual
// que Postgres, para que pagosController.js la maneje exactamente como en
// producción.
// ==========================================================================

const crypto = require("crypto");

const CODIGO_VIOLACION_UNICA_POSTGRES = "23505";

function crearFakeSupabasePagos() {

    const dispositivos = [];
    const movimientos = [];

    function tabla(nombre) {

        if (nombre === "pagos_dispositivos") return dispositivos;
        if (nombre === "pagos_movimientos") return movimientos;

        throw new Error(`fakeSupabasePagos: tabla no soportada "${nombre}"`);

    }

    function idNuevo() {
        return crypto.randomUUID();
    }

    function crearQuery(nombreTabla) {

        let modo = null; // 'select' | 'insert' | 'update'
        let payload = null;
        const filtrosEq = [];
        const filtrosNeq = [];
        let ordenCampo = null;
        let ordenAsc = true;
        let limiteN = null;

        function coincide(fila) {

            return filtrosEq.every(([c, v]) => fila[c] === v) &&
                filtrosNeq.every(([c, v]) => fila[c] !== v);

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

            neq(campo, valor) {
                filtrosNeq.push([campo, valor]);
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

                const r = await ejecutar();

                if (r.error) return r;

                if (r.data === null || r.data === undefined) {
                    return { data: null, error: { message: "single(): 0 filas" } };
                }

                return { data: r.data, error: null };

            },

            async maybeSingle() {

                const r = await ejecutar();

                if (r.error) return r;

                if (Array.isArray(r.data)) {
                    return { data: r.data.length ? r.data[0] : null, error: null };
                }

                return { data: r.data ?? null, error: null };

            },

            then(onFulfilled, onRejected) {
                return ejecutar().then(onFulfilled, onRejected);
            }

        };

        async function ejecutar() {

            const filas = tabla(nombreTabla);

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

                const fila = {
                    id: payload.id || idNuevo(),
                    created_at: new Date().toISOString(),
                    ...payload
                };

                if (nombreTabla === "pagos_movimientos" && fila.estado !== "duplicado") {

                    // Réplica del índice único parcial real (ver migración 005).
                    const choque = filas.find(f =>
                        f.usuario_id === fila.usuario_id &&
                        f.hash_duplicado === fila.hash_duplicado &&
                        f.estado !== "duplicado"
                    );

                    if (choque) {

                        return {
                            data: null,
                            error: {
                                code: CODIGO_VIOLACION_UNICA_POSTGRES,
                                message: "duplicate key value violates unique constraint \"pagos_movimientos_unico_no_duplicado\""
                            }
                        };

                    }

                }

                filas.push(fila);

                return { data: fila, error: null };

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

            return { data: null, error: { message: `fakeSupabasePagos: modo no soportado (${modo})` } };

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

        _dispositivos: () => dispositivos,
        _movimientos: () => movimientos,

        _agregarDispositivo(fila) {
            const completa = { id: idNuevo(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...fila };
            dispositivos.push(completa);
            return completa;
        }

    };

}

module.exports = { crearFakeSupabasePagos };
