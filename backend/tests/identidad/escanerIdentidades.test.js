// ==========================================================================
// PRUEBAS DEL MINI ESCÁNER DE IDENTIDADES (DRY-RUN).
//
// Igual que identidad.test.js: script plano de Node, sin dependencias
// nuevas. No requiere una sesión real de Baileys — usa objetos "sock" y
// "participante" con exactamente la forma que documenta Baileys
// (Types/Contact.d.ts: id, lid, phoneNumber, name, notify, verifiedName).
//
//     node backend/tests/identidad/escanerIdentidades.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const { crearFakeSupabase } = require("./fakeSupabase");

const RUTA_SUPABASE =
    path.resolve(__dirname, "../../lib/supabase.js");

const RUTA_OBTENER_USUARIO_GLOBAL =
    path.resolve(__dirname, "../../bot/funciones/usuarios/obtenerUsuarioGlobal.js");

const RUTA_ESCANER =
    path.resolve(__dirname, "../../bot/funciones/usuarios/escanerIdentidades.js");

// Carga el escáner (y, si se pide, obtenerUsuarioGlobal) con un fake de
// Supabase nuevo y aislado por prueba — solo hace falta para las pruebas
// de importación; las de dry-run no tocan Supabase en absoluto.
function cargarModulos() {

    const fake = crearFakeSupabase();

    require.cache[RUTA_SUPABASE] = {
        id: RUTA_SUPABASE,
        filename: RUTA_SUPABASE,
        loaded: true,
        exports: fake.client
    };

    delete require.cache[RUTA_OBTENER_USUARIO_GLOBAL];
    delete require.cache[RUTA_ESCANER];

    const escaner = require(RUTA_ESCANER);

    return { fake, escaner };

}

const resultados = [];

async function test(nombre, fn) {

    try {

        await fn();
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);

    } catch (err) {

        resultados.push({ nombre, ok: false, err });
        console.log(`❌ ${nombre}`);
        console.log(`   ${err.message}`);

    }

}

// Participante de grupo con la forma "Contact" de Baileys.
function participante({ id = null, lid = null, phoneNumber = null, notify = null, name = null, verifiedName = null } = {}) {

    return { id, lid, phoneNumber, notify, name, verifiedName };

}

function grupo(id, participants) {

    return { id, subject: `Grupo ${id}`, participants };

}

async function main() {

    // ======================================================================
    // Clasificación de identificadores crudos
    // ======================================================================
    await test("Identificador @lid se clasifica como 'lid' (nunca como teléfono)", () => {

        const { escaner } = cargarModulos();

        assert.strictEqual(escaner.clasificarJid("123456789@lid"), "lid");

    });

    await test("Identificador @s.whatsapp.net se clasifica como 'telefono'", () => {

        const { escaner } = cargarModulos();

        assert.strictEqual(escaner.clasificarJid("573001112222@s.whatsapp.net"), "telefono");

    });

    await test("Identificador de grupo (@g.us) no se clasifica como lid ni teléfono", () => {

        const { escaner } = cargarModulos();

        assert.strictEqual(escaner.clasificarJid("123456789@g.us"), "desconocido");

    });

    // ======================================================================
    // 1. Solo LID
    // ======================================================================
    await test("1. Participante con solo LID produce candidato {lid, telefono:null}", () => {

        const { escaner } = cargarModulos();

        const candidato = escaner.extraerCandidatoDeParticipante(
            participante({ id: "111@lid" }),
            { grupoId: "g1@g.us" }
        );

        assert.ok(candidato);
        assert.strictEqual(candidato.lid, "111@lid");
        assert.strictEqual(candidato.telefono, null);

    });

    // ======================================================================
    // 2. Solo teléfono
    // ======================================================================
    await test("2. Participante con solo teléfono produce candidato {telefono, lid:null}", () => {

        const { escaner } = cargarModulos();

        const candidato = escaner.extraerCandidatoDeParticipante(
            participante({ id: "573001112222@s.whatsapp.net" }),
            { grupoId: "g1@g.us" }
        );

        assert.ok(candidato);
        assert.strictEqual(candidato.telefono, "3001112222", "debe quitar el prefijo de país 57");
        assert.strictEqual(candidato.lid, null);

    });

    // ======================================================================
    // 3. LID + teléfono en el mismo participante (Baileys los separa en
    //    campos distintos: .lid y .phoneNumber)
    // ======================================================================
    await test("3. Participante con LID + teléfono en campos separados produce un único candidato completo", () => {

        const { escaner, fake } = cargarModulos();

        const candidato = escaner.extraerCandidatoDeParticipante(
            participante({
                id: "222@lid",
                lid: "222@lid",
                phoneNumber: "573002223333@s.whatsapp.net",
                notify: "Cliente Completo"
            }),
            { grupoId: "g1@g.us" }
        );

        assert.ok(candidato);
        assert.strictEqual(candidato.lid, "222@lid");
        assert.strictEqual(candidato.telefono, "3002223333");
        assert.strictEqual(candidato.nombre, "Cliente Completo");

        const { identidades } = escaner.reconciliarIdentidades([candidato]);

        assert.strictEqual(identidades.length, 1);
        assert.strictEqual(identidades[0].lid, "222@lid");
        assert.strictEqual(identidades[0].telefono, "3002223333");

    });

    // ======================================================================
    // 4. LID encontrado primero, teléfono después (mismo usuario)
    // ======================================================================
    await test("4. LID primero y teléfono después (misma identidad) → se completa, no se duplica", () => {

        const { escaner } = cargarModulos();

        const candidatos = [
            { lid: "A@lid", telefono: null, nombre: null, fuente: { grupoId: "g1@g.us" } },
            { lid: "A@lid", telefono: "3001110000", nombre: "Ana", fuente: { grupoId: "g2@g.us" } }
        ];

        const { identidades, conflictos } = escaner.reconciliarIdentidades(candidatos);

        assert.strictEqual(identidades.length, 1);
        assert.strictEqual(conflictos.length, 0);
        assert.strictEqual(identidades[0].lid, "A@lid");
        assert.strictEqual(identidades[0].telefono, "3001110000");
        assert.strictEqual(identidades[0].nombre, "Ana");

    });

    // ======================================================================
    // 5. Teléfono primero, LID después (mismo usuario)
    // ======================================================================
    await test("5. Teléfono primero y LID después (misma identidad) → se completa, no se duplica", () => {

        const { escaner } = cargarModulos();

        const candidatos = [
            { lid: null, telefono: "3002220000", nombre: null, fuente: { grupoId: "g1@g.us" } },
            { lid: "B@lid", telefono: "3002220000", nombre: "Beto", fuente: { grupoId: "g2@g.us" } }
        ];

        const { identidades, conflictos } = escaner.reconciliarIdentidades(candidatos);

        assert.strictEqual(identidades.length, 1);
        assert.strictEqual(conflictos.length, 0);
        assert.strictEqual(identidades[0].telefono, "3002220000");
        assert.strictEqual(identidades[0].lid, "B@lid");

    });

    // ======================================================================
    // 6. Misma persona en varios grupos → NO crea una segunda identidad
    // ======================================================================
    await test("6. Misma persona (mismo LID) en 3 grupos distintos → 1 sola identidad, 3 fuentes", () => {

        const { escaner } = cargarModulos();

        const candidatos = [
            { lid: "C@lid", telefono: "3003330000", nombre: "Carlos", fuente: { grupoId: "g1@g.us" } },
            { lid: "C@lid", telefono: "3003330000", nombre: "Carlos", fuente: { grupoId: "g2@g.us" } },
            { lid: "C@lid", telefono: "3003330000", nombre: "Carlos", fuente: { grupoId: "g3@g.us" } }
        ];

        const { identidades, duplicadosEvitados } = escaner.reconciliarIdentidades(candidatos);

        assert.strictEqual(identidades.length, 1, "no debe crear una identidad distinta por grupo");
        assert.strictEqual(identidades[0].fuentes.length, 3);
        assert.strictEqual(duplicadosEvitados, 2);

    });

    // ======================================================================
    // 7. Duplicados evitados (repetición exacta)
    // ======================================================================
    await test("7. Duplicado exacto del mismo candidato no genera una segunda identidad", () => {

        const { escaner } = cargarModulos();

        const candidato = { lid: "D@lid", telefono: null, nombre: null, fuente: { grupoId: "g1@g.us" } };

        const { identidades, duplicadosEvitados } = escaner.reconciliarIdentidades([candidato, { ...candidato, fuente: { grupoId: "g2@g.us" } }]);

        assert.strictEqual(identidades.length, 1);
        assert.strictEqual(duplicadosEvitados, 1);

    });

    // ======================================================================
    // 8. Conflicto LID/teléfono → NO fusiona, se registra
    // ======================================================================
    await test("8. LID → identidad A, teléfono → identidad B: conflicto registrado, sin fusión", () => {

        const { escaner } = cargarModulos();

        const candidatos = [
            { lid: "X@lid", telefono: null, nombre: null, fuente: { grupoId: "g1@g.us" } },
            { lid: null, telefono: "3009990000", nombre: null, fuente: { grupoId: "g2@g.us" } },
            { lid: "X@lid", telefono: "3009990000", nombre: null, fuente: { grupoId: "g3@g.us" } }
        ];

        const { identidades, conflictos } = escaner.reconciliarIdentidades(candidatos);

        assert.strictEqual(identidades.length, 2, "las 2 identidades originales deben seguir separadas");
        assert.strictEqual(conflictos.length, 1);
        assert.strictEqual(conflictos[0].tipo, "IDENTITY_CONFLICT");
        assert.strictEqual(conflictos[0].lid, "X@lid");
        assert.strictEqual(conflictos[0].telefono, "3009990000");

        // Ninguna de las 2 identidades originales fue tocada por el conflicto.
        const idA = identidades.find(i => i.lid === "X@lid");
        const idB = identidades.find(i => i.telefono === "3009990000" && i.lid !== "X@lid");

        assert.ok(idA);
        assert.strictEqual(idA.telefono, null, "no debe fusionarse el teléfono del conflicto en A");
        assert.ok(idB);
        assert.strictEqual(idB.lid, null, "no debe fusionarse el LID del conflicto en B");

    });

    // ======================================================================
    // 9. fromMe (análogo para participantes): el propio BOT nunca genera
    //    identidad aunque aparezca como participante de sus grupos.
    // ======================================================================
    await test("9. El propio BOT (sock.user) se excluye del escaneo aunque aparezca como participante", async () => {

        const { escaner } = cargarModulos();

        const sockFalso = {
            user: { id: "573106814436@s.whatsapp.net", lid: "999bot@lid", notify: "Mi Bot" },
            async groupFetchAllParticipating() {

                return {
                    "g1@g.us": grupo("g1@g.us", [
                        participante({ id: "573106814436@s.whatsapp.net", lid: "999bot@lid", notify: "Mi Bot" }), // el propio bot
                        participante({ id: "700@lid", notify: "Cliente Real" })
                    ])
                };

            }
        };

        const resultado = await escaner.escanearIdentidades({ sock: sockFalso });

        assert.strictEqual(resultado.estadisticas.participantesAnalizados, 2);
        assert.strictEqual(resultado.estadisticas.excluidosPorSerElBot, 1);
        assert.strictEqual(resultado.estadisticas.identidadesUnicasReconstruibles, 1);
        assert.strictEqual(resultado.identidades[0].lid, "700@lid");

        // El bot no debe aparecer en ninguna identidad reconstruida.
        const apareceElBot = resultado.identidades.some(
            i => i.lid === "999bot@lid" || i.telefono === "3106814436"
        );

        assert.strictEqual(apareceElBot, false);

    });

    // ======================================================================
    // 9-B. REGRESIÓN (bug real encontrado en producción): sock.user.lid
    //      trae sufijo de dispositivo ("...:11@lid") pero el mismo bot
    //      aparece en la lista de participantes de sus propios grupos SIN
    //      ese sufijo ("...@lid"). Una comparación de string exacto los
    //      trataba como personas distintas y dejaba crear un "usuario" del
    //      propio bot. Debe compararse por el "user" decodificado, no por
    //      el JID completo.
    // ======================================================================
    await test("9-B (regresión). El bot se excluye aunque su LID en el grupo no traiga el sufijo de dispositivo que sí trae sock.user.lid", async () => {

        const { escaner } = cargarModulos();

        const sockFalso = {
            user: { id: "573106814436:11@s.whatsapp.net", lid: "7156153774273:11@lid", notify: "Efaat III" },
            async groupFetchAllParticipating() {

                return {
                    "g1@g.us": grupo("g1@g.us", [
                        // El bot aparece en su propio grupo SIN el ":11" que sí
                        // trae sock.user.lid — exactamente el caso real que
                        // generó una fila fantasma del bot en "usuarios".
                        participante({ id: "7156153774273@lid", lid: "7156153774273@lid" }),
                        participante({ id: "800@lid", notify: "Cliente Real" })
                    ])
                };

            }
        };

        const resultado = await escaner.escanearIdentidades({ sock: sockFalso });

        assert.strictEqual(resultado.estadisticas.excluidosPorSerElBot, 1, "debe excluir al bot pese al sufijo de dispositivo distinto");
        assert.strictEqual(resultado.estadisticas.identidadesUnicasReconstruibles, 1);
        assert.strictEqual(resultado.identidades[0].lid, "800@lid");

        const apareceElBot = resultado.identidades.some(i => (i.lid || "").includes("7156153774273"));
        assert.strictEqual(apareceElBot, false, "el bot NUNCA debe quedar como una identidad reconstruida");

    });

    // ======================================================================
    // 10. Orquestador completo: varios grupos, participantes mixtos,
    //     formato de reporte y conteo de estadísticas end-to-end.
    // ======================================================================
    await test("10. escanearIdentidades: reporte end-to-end con varios grupos y tipos de identidad", async () => {

        const { escaner } = cargarModulos();

        const sockFalso = {
            user: { id: "573106814436@s.whatsapp.net" },
            async groupFetchAllParticipating() {

                return {
                    "g1@g.us": grupo("g1@g.us", [
                        participante({ id: "573106814436@s.whatsapp.net" }), // bot
                        participante({ id: "800@lid" }), // solo LID
                        participante({ id: "573007778888@s.whatsapp.net" }) // solo teléfono
                    ]),
                    "g2@g.us": grupo("g2@g.us", [
                        participante({ id: "800@lid", lid: "800@lid", phoneNumber: "573001112222@s.whatsapp.net", notify: "Ana Completa" }), // mismo de arriba, ahora con ambos
                        participante({ id: "573007778888@s.whatsapp.net" }) // mismo, repetido -> duplicado evitado
                    ])
                };

            }
        };

        const resultado = await escaner.escanearIdentidades({ sock: sockFalso });

        assert.strictEqual(resultado.modo, "dry-run");
        assert.strictEqual(resultado.estadisticas.gruposEncontrados, 2);
        assert.strictEqual(resultado.estadisticas.participantesAnalizados, 5);
        assert.strictEqual(resultado.estadisticas.excluidosPorSerElBot, 1);

        // Identidades esperadas: 800@lid (completada con teléfono en g2) +
        // 573007778888 (solo teléfono, repetido en g2 sin cambios) = 2.
        assert.strictEqual(resultado.estadisticas.identidadesUnicasReconstruibles, 2);
        assert.strictEqual(resultado.estadisticas.conLidYTelefono, 1);
        assert.strictEqual(resultado.estadisticas.soloTelefono, 1);
        assert.strictEqual(resultado.estadisticas.duplicadosEvitados, 1);
        assert.strictEqual(resultado.estadisticas.conflictos, 0);

        const texto = escaner.formatearReporteTexto(resultado);
        assert.ok(texto.includes("🔎 ESCÁNER DE IDENTIDADES"));
        assert.ok(texto.includes("Grupos encontrados: 2"));
        assert.ok(texto.includes("Identidades únicas reconstruibles: 2"));

    });

    // ======================================================================
    // 11. Nombre: prioriza notify sobre name/verifiedName
    // ======================================================================
    await test("11. El nombre se toma de 'notify' con preferencia sobre 'name'/'verifiedName'", () => {

        const { escaner } = cargarModulos();

        const candidato = escaner.extraerCandidatoDeParticipante(
            participante({ id: "900@lid", notify: "Nombre Propio", name: "Nombre En Mi Agenda", verifiedName: "Empresa S.A." })
        );

        assert.strictEqual(candidato.nombre, "Nombre Propio");

    });

    // ======================================================================
    // 12. Importación (modo B): reutiliza obtenerUsuarioGlobal, sin crear
    //     un segundo camino de escritura ni duplicar usuarios existentes.
    // ======================================================================
    await test("12. importarIdentidades reutiliza obtenerUsuarioGlobal (no duplica un usuario ya existente)", async () => {

        const { escaner, fake } = cargarModulos();

        // Usuario ya existente en Supabase con solo LID (p. ej. creado por
        // un mensaje real anterior).
        fake.tablas.usuarios.push({ id: "existente-1", lid: "800@lid", telefono: null, nombre: null });

        const identidadesReconstruidas = [
            { lid: "800@lid", telefono: "3001112222", nombre: "Ana Completa", fuentes: [{ grupoId: "g2@g.us" }] },
            { lid: "901@lid", telefono: null, nombre: null, fuentes: [{ grupoId: "g1@g.us" }] }
        ];

        const resultadoImport = await escaner.importarIdentidades({ identidades: identidadesReconstruidas });

        assert.strictEqual(resultadoImport.total, 2);
        assert.strictEqual(resultadoImport.importados, 2);

        // La identidad ya existente se REUTILIZA (mismo id), se completa el
        // teléfono, y no se crea una fila nueva para ella.
        assert.strictEqual(resultadoImport.resultados[0].usuario.id, "existente-1");
        assert.strictEqual(resultadoImport.resultados[0].usuario.telefono, "3001112222");

        // La segunda identidad (LID nuevo) sí crea una fila nueva.
        assert.notStrictEqual(resultadoImport.resultados[1].usuario.id, "existente-1");

        assert.strictEqual(fake.tablas.usuarios.length, 2, "no debe haber una tercera fila duplicada");

    });

    // ======================================================================
    // Resumen
    // ======================================================================

    const fallidos = resultados.filter(r => !r.ok);

    console.log("\n================================");
    console.log(`✅ Pasaron: ${resultados.length - fallidos.length}/${resultados.length}`);

    if (fallidos.length) {

        console.log(`❌ Fallaron: ${fallidos.length}`);
        fallidos.forEach(f => console.log(`   - ${f.nombre}: ${f.err.message}`));
        console.log("================================");
        process.exitCode = 1;

    } else {

        console.log("================================");

    }

}

main().catch(err => {

    console.error("💥 Error inesperado ejecutando las pruebas del escáner de identidades");
    console.error(err);
    process.exitCode = 1;

});
