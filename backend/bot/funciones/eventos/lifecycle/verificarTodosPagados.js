const { estadoDelSorteo } = require("../sorteoReal");

// ¿Están pagados TODOS los números únicos del sorteo lógico de `evento`?
//
// Antes contaba filas 'pagado' con la misma identidad y las comparaba con
// cantidad_numeros: un número duplicado podía contarse dos veces, y nada
// garantizaba que fueran los 100 números distintos del sorteo. Ahora se lee
// la tabla real UNA vez (sorteoReal.js) y se exige que cada número esperado
// (00..99) esté pagado por ESTE sorteo. libre, reservado, bloqueado y
// en_proceso nunca cuentan como pagados.
//
// Ante cualquier error de lectura devuelve false: nunca se cierra un sorteo
// sin poder demostrar que está completo.
async function verificarTodosPagados(evento) {

    if (!evento) return false;

    const estado = await estadoDelSorteo(evento);

    if (!estado.ok) {

        console.log("❌ Error verificando pagos:", estado.error);
        return false;

    }

    return estado.completo;

}

module.exports = {
    verificarTodosPagados
};
