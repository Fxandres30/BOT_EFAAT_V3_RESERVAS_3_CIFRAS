// ==========================================================================
// Diagnóstico de las CONSULTAS DE PAGO de un cliente con los datos REALES.
// SOLO LECTURA: no escribe, no envía mensajes y no muestra teléfonos
// completos ni claves.
//
//   node scripts/diagnosticarPagos.js <usuario_id_cliente> [grupo_id] [telefono_participante]
//
// Muestra, en el orden en que el bot decide la respuesta a «¿qué debo?»:
//   1. Interruptores del panel (configuracion_seleccion_mensajes) de los
//      tipos de pago: consulta_pago_sin_pago / _pago_parcial /
//      _pago_completo / _sin_saldo (y los heredados consulta_pago,
//      mis_numeros, multiple). Un estado con habilitada=false hace que el
//      bot CALLE para los clientes en ese estado (sin fila = activo).
//   2. Plantillas habilitadas de esos tipos.
//   3. Con grupo_id: el sorteo que el bot usaría en ese grupo
//      (consultarEvento: el activo o el más reciente) y cuántas filas tiene
//      el grupo.
//   4. Con teléfono: el participante (usuarios), sus números en ese sorteo
//      por estado, el estado de pago resultante y sus pendientes en otros
//      sorteos del cliente — exactamente la lectura que usa el bot.
// ==========================================================================

const supabase = require("../lib/supabase");
const { consultarEvento } = require("../bot/funciones/eventos/consultarEvento");
const { consultarMisNumerosPorEstado, consultarPendientesOtrosSorteos } = require("../bot/funciones/consultas/consultarMisNumeros");
const { determinarEstadoPago } = require("../shared/pagos/determinarEstadoPago");

const TIPOS = [
    "consulta_pago_sin_pago", "consulta_pago_pago_parcial", "consulta_pago_pago_completo", "consulta_pago_sin_saldo",
    "consulta_pago", "mis_numeros", "mis_reservas", "multiple"
];

const enmascarar = (t) => (t ? `${String(t).slice(0, 4)}…${String(t).slice(-2)}` : null);

async function main() {

    const [usuarioId, grupoId, telefono] = process.argv.slice(2);

    if (!usuarioId) {
        console.log("Uso: node scripts/diagnosticarPagos.js <usuario_id_cliente> [grupo_id] [telefono_participante]");
        process.exit(1);
    }

    console.log("\n1) Interruptores del panel (sin fila = activo)");
    const { data: config, error: e1 } = await supabase.from("configuracion_seleccion_mensajes")
        .select("tipo_respuesta, habilitada, modo_seleccion").eq("usuario_id", usuarioId).in("tipo_respuesta", TIPOS);
    if (e1) console.log("   ❌ no se pudo leer:", e1.message);
    for (const tipo of TIPOS) {
        const fila = (config || []).find(c => c.tipo_respuesta === tipo);
        const estado = !fila ? "activo (sin fila)" : fila.habilitada === false ? "DESACTIVADO -> el bot calla" : "activo";
        const nota = tipo === "consulta_pago" ? " (heredado: el bot ya no lo consulta)" : "";
        console.log(`   ${tipo.padEnd(30)} ${estado}${nota}`);
    }

    console.log("\n2) Plantillas habilitadas");
    const { data: plantillas, error: e2 } = await supabase.from("plantillas_mensaje")
        .select("tipo_respuesta, habilitada").eq("usuario_id", usuarioId).in("tipo_respuesta", TIPOS);
    if (e2) console.log("   ❌ no se pudo leer:", e2.message);
    for (const tipo of TIPOS) {
        const de = (plantillas || []).filter(p => p.tipo_respuesta === tipo);
        console.log(`   ${tipo.padEnd(30)} ${de.filter(p => p.habilitada).length}/${de.length} (sin habilitadas = mensaje fijo)`);
    }

    if (!grupoId) return;

    console.log("\n3) Sorteo del grupo");
    const { data: filas } = await supabase.from("eventos_bot")
        .select("id, nombre_evento, hora_fin, fecha_evento, activo, estado, cierre_motivo, valor, tabla, identidad_evento_real")
        .eq("usuario_id", usuarioId).eq("grupo_id", grupoId).order("creado_en", { ascending: false });
    console.log(`   filas del cliente en el grupo: ${(filas || []).length}`);
    for (const f of (filas || []).slice(0, 5)) {
        console.log(`   - ${f.nombre_evento} ${f.hora_fin} ${String(f.fecha_evento || "").slice(0, 10)} activo=${f.activo} estado=${f.estado}${f.cierre_motivo ? ` (${f.cierre_motivo})` : ""} valor=${f.valor} tabla=${f.tabla}`);
    }
    const evento = await consultarEvento(grupoId, usuarioId);
    console.log(evento ? `   ➜ el bot responde con: ${evento.nombre_evento} ${evento.hora_fin} (id ${evento.id})` : "   ➜ SIN sorteo: el bot no responde consultas en este grupo");

    if (!telefono || !evento) return;

    console.log("\n4) Participante");
    const sinPrefijo = String(telefono).replace(/\D/g, "");
    // Mismo formato que guarda la identidad: 57 + 10 dígitos en Colombia.
    const digitos = sinPrefijo.length === 10 ? `57${sinPrefijo}` : sinPrefijo;
    const { data: usuarios, error: e4 } = await supabase.from("usuarios").select("id, lid, telefono").eq("telefono", digitos);
    if (e4) { console.log("   ❌ no se pudo leer usuarios:", e4.message); return; }
    if (!usuarios?.length) { console.log(`   ❌ no existe un usuario con teléfono ${enmascarar(digitos)} (¿normalización 57XXXXXXXXXX?)`); return; }
    if (usuarios.length > 1) console.log(`   ⚠️ ${usuarios.length} usuarios con ese teléfono (identidad duplicada)`);

    const usuario = usuarios[0];
    const datos = await consultarMisNumerosPorEstado({ evento, usuario });
    const estadoPago = determinarEstadoPago({ total: datos.total, cantidadPagados: datos.pagados.length, cantidadPendientes: datos.reservados.length });
    console.log(`   usuario ${usuario.id} (tel ${enmascarar(usuario.telefono)})`);
    console.log(`   reservados: ${datos.reservados.join(", ") || "—"}`);
    console.log(`   pagados:    ${datos.pagados.join(", ") || "—"}`);
    console.log(`   estado de pago: ${estadoPago} -> tipo de respuesta consulta_pago_${estadoPago}`);
    const fila = (config || []).find(c => c.tipo_respuesta === `consulta_pago_${estadoPago}`);
    if (fila?.habilitada === false) console.log(`   🔇 ESTE ESTADO ESTÁ DESACTIVADO EN EL PANEL: «¿qué debo?» no recibe respuesta.`);

    const otros = await consultarPendientesOtrosSorteos({ evento, usuario });
    console.log(`   pendientes en otros sorteos: ${otros.length ? otros.map(o => `${o.nombre} ${o.hora_fin} (${o.numeros.join(", ")})`).join("; ") : "ninguno"}`);

}

main().then(() => process.exit(0)).catch(err => { console.error("❌", err?.message); process.exit(1); });
