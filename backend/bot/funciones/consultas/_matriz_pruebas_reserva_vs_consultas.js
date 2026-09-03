// Matriz de pruebas — corrección "reserva vs consultas" del detector de
// intención. Script de verificación, NO forma parte del flujo de producción.
// Ejecutar: node bot/funciones/consultas/_matriz_pruebas_reserva_vs_consultas.js
//
// Objetivo: FLEXIBLE en cómo habla el usuario, EXACTO en qué quiere hacer.
// La detección sigue siendo 100% determinística (sin Gemini/IA).
const { detectarIntencion } = require("./detectarIntencion");

const CASOS = [

    // ===== RESERVA — el usuario está TOMANDO uno o varios números =====
    { msg: "45", esperado: "reserva" },
    { msg: "89", esperado: "reserva" },
    { msg: "23 y 47", esperado: "reserva" },
    { msg: "quiero el 45", esperado: "reserva" },
    { msg: "quiero 45", esperado: "reserva" },
    { msg: "yo quiero el 45", esperado: "reserva" },
    { msg: "mío el 89", esperado: "reserva" },
    { msg: "mio 45", esperado: "reserva" },
    { msg: "mio el 45 gracias", esperado: "reserva" },
    { msg: "45 mío", esperado: "reserva" },
    { msg: "el 91 es mío", esperado: "reserva" },
    { msg: "para mí el 55", esperado: "reserva" },
    { msg: "para mí 34", esperado: "reserva" },
    { msg: "el 45 para mi", esperado: "reserva" },
    { msg: "45 pa mi", esperado: "reserva" },
    { msg: "me quedo con el 32", esperado: "reserva" },
    { msg: "me quedo con 45", esperado: "reserva" },
    { msg: "me llevo el 44", esperado: "reserva" },
    { msg: "dame el 18", esperado: "reserva" },
    { msg: "dame el 23", esperado: "reserva" },
    { msg: "me das el 45", esperado: "reserva" },
    { msg: "apúntame el 72", esperado: "reserva" },
    { msg: "apártame el 9", esperado: "reserva" },
    { msg: "resérvame el 18", esperado: "reserva" },
    { msg: "quiero apartar el 15", esperado: "reserva" },
    { msg: "me apunto el 30", esperado: "reserva" },
    { msg: "cojo el 21", esperado: "reserva" },
    { msg: "regálame el 50", esperado: "reserva" },
    { msg: "quiero 12 y 34", esperado: "reserva" },
    { msg: "los 45 y 89 para mí", esperado: "reserva" },
    { msg: "el 8 y el 9 para mí", esperado: "reserva" },
    { msg: "yo el 33", esperado: "reserva" },
    // el caso reportado
    { msg: "mío el 55 con bogota gracias", esperado: "reserva" },
    { msg: "mio el 55 con bogota", esperado: "reserva" },
    { msg: "55 mío con bogotá", esperado: "reserva" },

    // ===== MIS NÚMEROS — pregunta por sus números (lista) =====
    { msg: "qué números tengo", esperado: "mis_numeros" },
    { msg: "cuáles son mis números", esperado: "mis_numeros" },
    { msg: "qué números son los míos", esperado: "mis_numeros" },
    { msg: "mis números cuáles son", esperado: "mis_numeros" },
    { msg: "mis números", esperado: "mis_numeros" },
    { msg: "cuáles tengo", esperado: "mis_numeros" },
    { msg: "qué tengo yo", esperado: "mis_numeros" },
    { msg: "los míos", esperado: "mis_numeros" },
    { msg: "dime los que tengo", esperado: "mis_numeros" },
    { msg: "muéstrame mis números", esperado: "mis_numeros" },
    { msg: "qué números agarré", esperado: "mis_numeros" },

    // ===== CANTIDAD — pregunta cuántos lleva =====
    { msg: "cuántos tengo", esperado: "cantidad_reservas" },
    { msg: "cuántos tengo yo", esperado: "cantidad_reservas" },
    { msg: "cuántos llevo", esperado: "cantidad_reservas" },
    { msg: "cuántos llevo ya", esperado: "cantidad_reservas" },
    { msg: "cuántos números tengo", esperado: "cantidad_reservas" },
    { msg: "cuántos números llevo", esperado: "cantidad_reservas" },
    { msg: "cuántos son los míos", esperado: "cantidad_reservas" },
    { msg: "cuántos he cogido", esperado: "cantidad_reservas" },
    { msg: "cuántas reservas tengo", esperado: "cantidad_reservas" },
    { msg: "cuántas llevo", esperado: "cantidad_reservas" },

    // ===== PAGO — pregunta por dinero / deuda / saldo (silencio actual) =====
    { msg: "qué debo", esperado: "consulta_pago" },
    { msg: "cuánto debo", esperado: "consulta_pago" },
    { msg: "cuánto es lo mío", esperado: "consulta_pago" },
    { msg: "cuánto me toca pagar", esperado: "consulta_pago" },
    { msg: "cuánto tengo que pagar", esperado: "consulta_pago" },
    { msg: "qué tengo que pagar", esperado: "consulta_pago" },
    { msg: "cuánto debo pagar", esperado: "consulta_pago" },
    { msg: "cuánto me falta", esperado: "consulta_pago" },
    { msg: "cuánto me falta pagar", esperado: "consulta_pago" },
    { msg: "cuánto llevo", esperado: "consulta_pago" },
    { msg: "cuánto he pagado", esperado: "consulta_pago" },
    // trampa: dinero + número -> pago, NUNCA reserva
    { msg: "¿cuánto debo por el 45?", esperado: "consulta_pago" },
    { msg: "cuánto debo por el 45", esperado: "consulta_pago" },

    // ===== NÚMERO ESPECÍFICO — pregunta por el ESTADO/DUEÑO de un número =====
    { msg: "está libre el 45", esperado: "numero_especifico" },
    { msg: "¿está libre el 45?", esperado: "numero_especifico" },
    { msg: "el 45 está ocupado", esperado: "numero_especifico" },
    { msg: "el 45 está libre?", esperado: "numero_especifico" },
    { msg: "está disponible el 45", esperado: "numero_especifico" },
    { msg: "quién tiene el 45", esperado: "numero_especifico" },
    { msg: "qué pasa con el 45", esperado: "numero_especifico" },
    { msg: "el 45 ya está reservado?", esperado: "numero_especifico" },
    { msg: "el 45 ya está pagado?", esperado: "numero_especifico" },
    { msg: "puedo reservar el 45", esperado: "numero_especifico" },
    { msg: "el 45 sigue libre?", esperado: "numero_especifico" },
    { msg: "el 45 aún disponible?", esperado: "numero_especifico" },
    { msg: "alguien tiene el 45?", esperado: "numero_especifico" },
    { msg: "lo tiene alguien el 45", esperado: "numero_especifico" },
    // ...pero si además expresa que lo toma -> reserva (ambigüedad
    // "toma + condición de disponibilidad")
    { msg: "quiero el 45 que esté libre", esperado: "reserva" },
    { msg: "45 libre para mí", esperado: "reserva" },
    { msg: "sepárame el 45 ¿está libre?", esperado: "reserva" },
    { msg: "apártame el 45 si está libre", esperado: "reserva" },
    { msg: "resérvame el 45 si está disponible", esperado: "reserva" },
    { msg: "dame el 45 si está libre", esperado: "reserva" },
    { msg: "quiero el 45 si está libre", esperado: "reserva" },
    { msg: "cojo el 45 si sigue libre", esperado: "reserva" },
    { msg: "me llevo el 45 si está libre", esperado: "reserva" },
    // ...pero una pregunta pura de estado NO se vuelve reserva
    { msg: "quiero saber si el 45 está libre", esperado: "numero_especifico" },
    { msg: "quiero consultar si el 45 está ocupado", esperado: "numero_especifico" },

    // ===== NEGATIVOS — conversación normal, NO respuesta =====
    { msg: "hola", esperado: "ninguna" },
    { msg: "buenas", esperado: "ninguna" },
    { msg: "buen día", esperado: "ninguna" },
    { msg: "buenos días familia", esperado: "ninguna" },
    { msg: "jajaja", esperado: "ninguna" },
    { msg: "jaja qué bueno", esperado: "ninguna" },
    { msg: "😂", esperado: "ninguna" },
    { msg: "gracias", esperado: "ninguna" },
    { msg: "listo gracias", esperado: "ninguna" },
    { msg: "ok", esperado: "ninguna" },
    { msg: "feliz día", esperado: "ninguna" },
    { msg: "hace 45 minutos", esperado: "ninguna" },

    // ===== SEGURIDAD — preguntas que NO deben volverse reserva =====
    { msg: "¿qué números tengo?", esperado: "mis_numeros" },
    { msg: "¿cuántos tengo?", esperado: "cantidad_reservas" },
    { msg: "¿quién tiene el 45?", esperado: "numero_especifico" },
    { msg: "¿el 45 está ocupado?", esperado: "numero_especifico" }

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

    process.exit(1);

}
