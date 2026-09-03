// Matriz de pruebas — Fase 6 (auditoría de comprensión de consultas).
// Script temporal de verificación, NO forma parte del flujo de producción.
// Ejecutar: node bot/funciones/consultas/_matriz_pruebas_fase6.js
const { detectarIntencion } = require("./detectarIntencion");

const CASOS = [

    // ===== 1. MIS NÚMEROS =====
    { msg: "cuáles son mis números", esperado: "mis_numeros" },
    { msg: "cuales son mis numeros", esperado: "mis_numeros" },
    { msg: "qué números tengo", esperado: "mis_numeros" },
    { msg: "que numeros tengo", esperado: "mis_numeros" },
    { msg: "qué números tengo yo", esperado: "mis_numeros" },
    { msg: "cuáles tengo", esperado: "mis_numeros" },
    { msg: "qué tengo", esperado: "mis_numeros" },
    { msg: "dime mis números", esperado: "mis_numeros" },
    { msg: "muéstrame mis números", esperado: "mis_numeros" },
    { msg: "mis números", esperado: "mis_numeros" },
    { msg: "mis numeros", esperado: "mis_numeros" },
    { msg: "mis num", esperado: "mis_numeros" },
    { msg: "que numero tengo", esperado: "mis_numeros" },
    { msg: "qué número tengo", esperado: "mis_numeros" },
    { msg: "qué números reservé", esperado: "mis_numeros" },
    { msg: "qué números agarré", esperado: "mis_numeros" },
    { msg: "cuáles agarré", esperado: "mis_numeros" },
    { msg: "qué números escogí", esperado: "mis_numeros" },
    { msg: "cuáles escogí", esperado: "mis_numeros" },
    { msg: "qué números me quedaron", esperado: "mis_numeros" },
    { msg: "cuáles son los míos", esperado: "mis_numeros" },
    { msg: "qué números son los míos", esperado: "mis_numeros" },
    { msg: "los míos cuáles son", esperado: "mis_numeros" },
    { msg: "me dices mis números", esperado: "mis_numeros" },
    { msg: "quiero ver mis números", esperado: "mis_numeros" },
    { msg: "quiero saber qué números tengo", esperado: "mis_numeros" },
    { msg: "recuérdame mis números", esperado: "mis_numeros" },
    { msg: "cuáles tengo reservados", esperado: "mis_reservas" }, // ambiguo: ver informe (misma data que mis_numeros)
    { msg: "qué tengo reservado", esperado: "mis_reservas" }, // ambiguo: ver informe
    // errores ortográficos
    { msg: "cuales son mis nuemros", esperado: "mis_numeros" },
    { msg: "que nuemros tengo", esperado: "mis_numeros" },
    { msg: "mis nuemros", esperado: "mis_numeros" },
    { msg: "que numeros tnego", esperado: "mis_numeros" },
    { msg: "cuales tengo yo", esperado: "mis_numeros" },

    // ===== 2. MIS RESERVAS =====
    { msg: "cuáles son mis reservas", esperado: "mis_reservas" },
    { msg: "mis reservas", esperado: "mis_reservas" },
    { msg: "qué reservé", esperado: "mis_reservas" },
    { msg: "qué reservas tengo", esperado: "mis_reservas" },
    { msg: "muéstrame mis reservas", esperado: "mis_reservas" },
    { msg: "quiero ver mis reservas", esperado: "mis_reservas" },
    { msg: "mis reservaciones", esperado: "mis_reservas" },
    { msg: "mis reservaciones actuales", esperado: "mis_reservas" },

    // ===== 3. CANTIDAD DE RESERVAS =====
    { msg: "cuántos números tengo", esperado: "cantidad_reservas" },
    { msg: "cuantos numeros tengo", esperado: "cantidad_reservas" },
    { msg: "cuántos tengo", esperado: "cantidad_reservas" },
    { msg: "cuántos reservé", esperado: "cantidad_reservas" },
    { msg: "cuántas reservas tengo", esperado: "cantidad_reservas" },
    { msg: "cuántas reservas hice", esperado: "cantidad_reservas" },
    { msg: "cuántos números he reservado", esperado: "cantidad_reservas" },
    { msg: "cuántos números son míos", esperado: "cantidad_reservas" },
    // disambiguación explícita pedida en la auditoría
    { msg: "¿Cuántos números tengo?", esperado: "cantidad_reservas" },
    { msg: "¿Qué números tengo?", esperado: "mis_numeros" },
    { msg: "¿Cuáles son mis números?", esperado: "mis_numeros" },

    // ===== 4. NÚMERO ESPECÍFICO =====
    { msg: "el 25 está libre?", esperado: "numero_especifico" },
    { msg: "está disponible el 25?", esperado: "numero_especifico" },
    { msg: "el número 25 está ocupado?", esperado: "numero_especifico" },
    { msg: "qué pasa con el 25?", esperado: "numero_especifico" },
    { msg: "quién tiene el 25?", esperado: "numero_especifico" },
    { msg: "consulta el 25", esperado: "numero_especifico" },
    { msg: "puedo reservar el 25?", esperado: "numero_especifico" },
    { msg: "el 25", esperado: "reserva" }, // ver informe: se preserva el flujo de reserva existente

    // ===== 5. DISPONIBILIDAD =====
    { msg: "qué números quedan", esperado: "disponibilidad" },
    { msg: "qué números están libres", esperado: "disponibilidad" },
    { msg: "cuáles están disponibles", esperado: "disponibilidad" },
    { msg: "qué queda disponible", esperado: "disponibilidad" },
    { msg: "cuáles quedan", esperado: "disponibilidad" },
    { msg: "hay números libres", esperado: "disponibilidad" },
    { msg: "hay alguno libre", esperado: "disponibilidad" },
    { msg: "todavía quedan números", esperado: "disponibilidad" },
    { msg: "qué números puedo escoger", esperado: "disponibilidad" },
    { msg: "qué puedo reservar", esperado: "disponibilidad" },
    { msg: "qué números puedo reservar", esperado: "disponibilidad" },
    { msg: "muéstrame los disponibles", esperado: "disponibilidad" },
    { msg: "muéstrame los libres", esperado: "disponibilidad" },
    { msg: "cuáles puedo agarrar", esperado: "disponibilidad" },

    // ===== 6. INFORMACIÓN DEL EVENTO =====
    { msg: "a qué hora es", esperado: "info_evento" },
    { msg: "qué día es", esperado: "info_evento" },
    { msg: "cuando es", esperado: "info_evento" },
    { msg: "cuándo es el evento", esperado: "info_evento" },
    { msg: "a qué hora empieza", esperado: "info_evento" },
    { msg: "información del evento", esperado: "info_evento" },
    { msg: "info del evento", esperado: "info_evento" },
    { msg: "dame información", esperado: "info_evento" },
    { msg: "qué evento es", esperado: "info_evento" },
    { msg: "de qué es el evento", esperado: "info_evento" },

    // ===== 7. PAGOS (no implementado, debe quedar en silencio) =====
    { msg: "qué debo", esperado: "consulta_pago" },
    { msg: "cuánto debo", esperado: "consulta_pago" },
    { msg: "cuánto es lo mío", esperado: "consulta_pago" },
    { msg: "cuánto tengo que pagar", esperado: "consulta_pago" },
    { msg: "cuánto me falta", esperado: "consulta_pago" },
    { msg: "qué tengo que pagar", esperado: "consulta_pago" },
    { msg: "cuánto debo pagar", esperado: "consulta_pago" },
    { msg: "cuánto llevo", esperado: "consulta_pago" },
    { msg: "cuánto he pagado", esperado: "consulta_pago" },
    { msg: "cuánto me falta pagar", esperado: "consulta_pago" },
    // caso trampa explícito de la auditoría
    { msg: "qué números debo", esperado: "ninguna" },
    { msg: "¿cuánto debo por el 25?", esperado: "consulta_pago" },

    // ===== 8. NORMALIZACIÓN =====
    { msg: "QUE NUMEROS TENGO?", esperado: "mis_numeros" },
    { msg: "qué números tengo??", esperado: "mis_numeros" },
    { msg: "mis numeros!!!", esperado: "mis_numeros" },

    // ===== 9. MENSAJES CORTOS / CONTEXTO =====
    { msg: "mis números", esperado: "mis_numeros" },
    { msg: "los míos", esperado: "mis_numeros" },
    { msg: "cuáles?", esperado: "ninguna" }, // sin contexto suficiente, ver informe
    { msg: "cuántos?", esperado: "ninguna" }, // sin contexto suficiente, ver informe
    { msg: "y los míos?", esperado: "mis_numeros" },
    { msg: "y yo?", esperado: "ninguna" }, // sin contexto suficiente, ver informe
    { msg: "muéstramelos", esperado: "ninguna" }, // sin contexto suficiente, ver informe

    // ===== Reservas reales — NO deben cambiar =====
    { msg: "quiero el 27 y el 45", esperado: "reserva" },
    { msg: "dame el 12", esperado: "reserva" },
    { msg: "aparta el 8", esperado: "reserva" }

];

let pasaron = 0;
let fallaron = 0;
const fallos = [];

for (const caso of CASOS) {

    const resultado = detectarIntencion(caso.msg);
    const ok = resultado.tipo === caso.esperado;

    if (ok) {
        pasaron++;
    } else {
        fallaron++;
        fallos.push({ ...caso, obtenido: resultado.tipo });
    }

    console.log(`${ok ? "✅" : "❌"} "${caso.msg}" → esperado=${caso.esperado} obtenido=${resultado.tipo}`);

}

console.log("\n============================");
console.log(`TOTAL: ${CASOS.length}  ✅ PASA: ${pasaron}  ❌ FALLA: ${fallaron}`);
console.log("============================");

if (fallos.length > 0) {

    console.log("\nFallos:");
    fallos.forEach(f => console.log(` - "${f.msg}" esperado=${f.esperado} obtenido=${f.obtenido}`));

}
