// ==========================================================================
// Fake de Supabase para pruebas de identidad — SOLO para tests.
// No es un mock de librería genérico: implementa únicamente el subconjunto
// de la API encadenable de supabase-js que usan obtenerUsuarioGlobal.js,
// guardarMensajeGrupo.js, consultarMisNumeros.js y reservarNumeros.js:
//
//   .from(tabla).select(cols).eq(c,v).neq(c,v).in(c,vs).limit(n).order(c,opts)
//   .from(tabla).insert(obj).select().single()
//   .from(tabla).update(obj).eq(c,v).in(c,vs).select()
//
// El builder es "thenable" (implementa .then), igual que el query builder
// real de supabase-js, así que `await supabase.from(...).eq(...).limit(2)`
// funciona sin necesidad de un método terminal explícito.
// ==========================================================================

function crearFakeSupabase() {

    // Se preinicializan las tablas relevantes para que un caso donde el
    // código bajo prueba corta ANTES de llegar a hacer ninguna consulta
    // (p. ej. fromMe=true) siga dejando `tablas.usuarios` como un arreglo
    // vacío consultable, y no como `undefined`.
    const tablas = { usuarios: [], mensajes_grupos_sorteos: [] };

    let siguienteId = 1;

    // Errores forzados de un solo uso, por "tabla:operacion".
    // forzarProximoError('usuarios', 'insert', { code: '23505', ... }, efectoSecundario)
    const erroresForzados = {};

    function forzarProximoError(tabla, operacion, error, efectoSecundario = null) {

        erroresForzados[`${tabla}:${operacion}`] = { error, efectoSecundario };

    }

    function tabla(nombre) {

        if (!tablas[nombre]) tablas[nombre] = [];
        return tablas[nombre];

    }

    // Conteo de llamadas por tabla+modo — usado por la prueba de "una sola
    // resolución de identidad" para comprobar cuántas veces se consultó/
    // escribió realmente la tabla "usuarios" en todo un pipeline.
    const llamadas = {};

    function registrarLlamada(nombreTabla, modo) {

        if (!llamadas[nombreTabla]) llamadas[nombreTabla] = { select: 0, insert: 0, update: 0 };
        if (llamadas[nombreTabla][modo] != null) llamadas[nombreTabla][modo]++;

    }

    function crearQuery(nombreTabla) {

        let modo = null; // 'select' | 'insert' | 'update'
        let payload = null;
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

                // No cambia la ejecución en este fake: insert siempre
                // devuelve la fila única, y select+single no se usa hoy en
                // el código bajo prueba salvo tras insert.
                return builder;

            },

            then(onFulfilled, onRejected) {

                return ejecutar().then(onFulfilled, onRejected);

            }

        };

        async function ejecutar() {

            registrarLlamada(nombreTabla, modo);

            const filas = tabla(nombreTabla);

            if (modo === "select") {

                let resultado = filas.filter(fila =>
                    filtrosEq.every(([c, v]) => fila[c] === v) &&
                    filtrosNeq.every(([c, v]) => fila[c] !== v) &&
                    filtrosIn.every(([c, vs]) => vs.includes(fila[c]))
                );

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

                return { data: resultado, error: null };

            }

            if (modo === "insert") {

                const forzado = erroresForzados[`${nombreTabla}:insert`];

                if (forzado) {

                    delete erroresForzados[`${nombreTabla}:insert`];

                    if (forzado.efectoSecundario) forzado.efectoSecundario();

                    return { data: null, error: forzado.error };

                }

                const fila = { id: `id-${siguienteId++}`, ...payload };

                filas.push(fila);

                return { data: fila, error: null };

            }

            if (modo === "update") {

                const forzado = erroresForzados[`${nombreTabla}:update`];

                if (forzado) {

                    delete erroresForzados[`${nombreTabla}:update`];

                    if (forzado.efectoSecundario) forzado.efectoSecundario();

                    return { data: null, error: forzado.error };

                }

                const lista = tabla(nombreTabla);
                const actualizadas = [];

                for (let i = 0; i < lista.length; i++) {

                    const coincide =
                        filtrosEq.every(([c, v]) => lista[i][c] === v) &&
                        filtrosNeq.every(([c, v]) => lista[i][c] !== v) &&
                        filtrosIn.every(([c, vs]) => vs.includes(lista[i][c]));

                    if (coincide) {

                        lista[i] = { ...lista[i], ...payload };
                        actualizadas.push(lista[i]);

                    }

                }

                return { data: actualizadas, error: null };

            }

            return { data: null, error: { message: `fakeSupabase: modo no soportado (${modo})` } };

        }

        return builder;

    }

    const client = {

        from(nombreTabla) {

            tabla(nombreTabla); // asegura que exista el arreglo
            return crearQuery(nombreTabla);

        }

    };

    return { client, tablas, forzarProximoError, llamadas };

}

module.exports = { crearFakeSupabase };
