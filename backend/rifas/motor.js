// ==========================================================================
// rifas/motor.js — interruptor del motor de rifas.
//
//   MOTOR_RIFAS=nuevo   → cada rifa es independiente (tablas_rifas +
//                         numeros_rifa por tabla_id; migración 050).
//   cualquier otro valor o sin definir → "legado" (cuadrículas físicas
//                         compartidas por precio, como hasta ahora).
//
// Por defecto "legado": desplegar este código NO cambia nada hasta que se
// active a propósito (docs/rifas/MOTOR_RIFAS.md §8). Volver atrás = poner la
// variable en "legado" y reiniciar.
// ==========================================================================

const NUEVO = "nuevo";
const LEGADO = "legado";

function modoMotor() {
    return String(process.env.MOTOR_RIFAS || "").trim().toLowerCase() === NUEVO ? NUEVO : LEGADO;
}

const motorNuevo = () => modoMotor() === NUEVO;

module.exports = { modoMotor, motorNuevo, NUEVO, LEGADO };
