// ==========================================================================
// Fake de Supabase para las pruebas de "confirmación de pago por sticker".
// Mismo patrón que backend/tests/identidad/fakeSupabase.js (cada dominio de
// pruebas tiene su propio fake — mismo criterio que
// backend/tests/pagos/fakeSupabasePagos.js, no se comparte uno global).
//
// Diferencia deliberada respecto al fake de identidad: aquí SÍ se necesita
// `.maybeSingle()` funcionando de verdad (consultarEvento.js lo usa para
// leer eventos_bot), así que el modo "select" respeta un flag "terminal"
// (single/maybeSingle) y devuelve la PRIMERA fila o null, en vez de
// siempre el arreglo completo. El modo "insert"/"update" no cambia en
// absoluto respecto al fake de identidad.
// ==========================================================================

function crearFakeSupabase() {

    const tablas = {};

    let siguienteId = 1;

    function tabla(nombre) {

        if (!tablas[nombre]) tablas[nombre] = [];
        return tablas[nombre];

    }

    const llamadas = {};

    function registrarLlamada(nombreTabla, modo) {

        if (!llamadas[nombreTabla]) llamadas[nombreTabla] = { select: 0, insert: 0, update: 0 };
        if (llamadas[nombreTabla][modo] != null) llamadas[nombreTabla][modo]++;

    }

    function crearQuery(nombreTabla) {

        let modo = null; // 'select' | 'insert' | 'update' | 'upsert'
        let payload = null;
        let columnasConflicto = [];
        let terminal = false; // true tras .single()/.maybeSingle()
        const filtrosEq = [];
        const filtrosNeq = [];
        const filtrosIn = [];
        let limiteN = null;
        let ordenCampo = null;
        let ordenAsc = true;

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

            // Mismo contrato que supabase-js: opts.onConflict ("a,b") dice
            // qué columnas identifican la fila existente. Si coincide,
            // hace merge (update); si no, inserta una nueva — mismo
            // comportamiento que ya usan frontend/services/automatizacion/
            // automationConfigs.ts (guardarConfiguracion) y
            // gruposAutorizados.ts (autorizarGrupo), y ahora también
            // configuracionStickerPago.js (activarModoRegistro).
            upsert(obj, opts) {

                modo = "upsert";
                payload = obj;
                columnasConflicto = (opts?.onConflict || "")
                    .split(",")
                    .map(s => s.trim())
                    .filter(Boolean);
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

            in(campo, valores) {

                filtrosIn.push([campo, valores]);
                return builder;

            },

            limit(n) {

                limiteN = n;
                return builder;

            },

            order(campo, opts) {

                ordenCampo = campo;
                ordenAsc = !opts || opts.ascending !== false;
                return builder;

            },

            single() {

                terminal = true;
                return builder;

            },

            maybeSingle() {

                terminal = true;
                return builder;

            },

            then(onFulfilled, onRejected) {

                return ejecutar().then(onFulfilled, onRejected);

            }

        };

        function coincide(fila) {

            return (
                filtrosEq.every(([c, v]) => fila[c] === v) &&
                filtrosNeq.every(([c, v]) => fila[c] !== v) &&
                filtrosIn.every(([c, vs]) => vs.includes(fila[c]))
            );

        }

        async function ejecutar() {

            registrarLlamada(nombreTabla, modo);

            const filas = tabla(nombreTabla);

            if (modo === "select") {

                let resultado = filas.filter(coincide);

                if (ordenCampo) {

                    resultado = [...resultado].sort((a, b) => {

                        if (a[ordenCampo] === b[ordenCampo]) return 0;

                        const mayor = a[ordenCampo] > b[ordenCampo];

                        return ordenAsc
                            ? (mayor ? 1 : -1)
                            : (mayor ? -1 : 1);

                    });

                }

                if (limiteN != null) resultado = resultado.slice(0, limiteN);

                if (terminal) {

                    return { data: resultado[0] ?? null, error: null };

                }

                return { data: resultado, error: null };

            }

            if (modo === "insert") {

                if (Array.isArray(payload)) {

                    const filasNuevas = payload.map(p => ({ id: `id-${siguienteId++}`, ...p }));
                    filas.push(...filasNuevas);

                    return { data: filasNuevas, error: null };

                }

                const fila = { id: `id-${siguienteId++}`, ...payload };
                filas.push(fila);

                return { data: fila, error: null };

            }

            if (modo === "update") {

                const lista = tabla(nombreTabla);
                const actualizadas = [];

                for (let i = 0; i < lista.length; i++) {

                    if (coincide(lista[i])) {

                        lista[i] = { ...lista[i], ...payload };
                        actualizadas.push(lista[i]);

                    }

                }

                return { data: actualizadas, error: null };

            }

            if (modo === "upsert") {

                const columnas = columnasConflicto.length ? columnasConflicto : Object.keys(payload);

                const existente = filas.find(f => columnas.every(c => f[c] === payload[c]));

                let resultado;

                if (existente) {

                    Object.assign(existente, payload);
                    resultado = existente;

                } else {

                    resultado = { id: `id-${siguienteId++}`, ...payload };
                    filas.push(resultado);

                }

                if (terminal) {

                    return { data: resultado, error: null };

                }

                return { data: [resultado], error: null };

            }

            return { data: null, error: { message: `fakeSupabase: modo no soportado (${modo})` } };

        }

        return builder;

    }

    const client = {

        from(nombreTabla) {

            tabla(nombreTabla);
            return crearQuery(nombreTabla);

        }

    };

    // Expuesto para que las pruebas puedan sembrar filas directamente
    // (fake.tabla("usuarios").push({...})) sin depender de que algo haya
    // llamado antes a client.from("usuarios") — a diferencia de acceder a
    // fake.tablas.usuarios a pelo, esto SIEMPRE asegura que el arreglo
    // exista, incluso para nombres de tabla dinámicos (evento.tabla).
    return { client, tablas, llamadas, tabla };

}

module.exports = { crearFakeSupabase };
