// ==========================================================================
// Middleware de autenticación de dispositivo Android para las rutas de
// /pagos/*. NO existía ningún middleware de auth HTTP en este backend
// antes de esto (routes/sessions.js no tiene ninguno) — este es exclusivo
// del módulo de pagos, no se toca ni se reutiliza en sesiones/reservas.
//
// Formato de credencial (header Authorization: Bearer <credencial>):
//
//   <dispositivo_id>.<secreto_plano>
//
// El id permite un lookup O(1) por índice (no se puede "buscar por hash"
// sin id). El secreto se verifica con crypto.scrypt + comparación en
// tiempo constante contra pagos_dispositivos.credencial_hash — el secreto
// en texto plano NUNCA se guarda ni se loguea.
//
// GARANTÍA CENTRAL: dispositivo_id y usuario_id SIEMPRE se resuelven desde
// la fila de pagos_dispositivos ya autenticada, nunca desde el body de la
// petición — así un dispositivo jamás puede enviar movimientos "a nombre"
// de otro usuario_id, sin importar qué mande el cliente.
// ==========================================================================

const supabase = require("../lib/supabase");
const { verificarCredencial } = require("./credenciales");

async function autenticarDispositivo(req, res, next) {

    try {

        const header = req.headers.authorization || "";
        const coincidencia = header.match(/^Bearer\s+(.+)$/i);

        if (!coincidencia) {

            return res.status(401).json({
                success: false,
                code: "SIN_CREDENCIAL",
                error: "Falta el header Authorization: Bearer <credencial>"
            });

        }

        const credencial = coincidencia[1].trim();
        const separador = credencial.indexOf(".");

        if (separador <= 0 || separador === credencial.length - 1) {

            return res.status(401).json({
                success: false,
                code: "CREDENCIAL_INVALIDA",
                error: "Formato de credencial inválido"
            });

        }

        const dispositivoId = credencial.slice(0, separador);
        const secreto = credencial.slice(separador + 1);

        const { data: dispositivo, error } = await supabase
            .from("pagos_dispositivos")
            .select("id, usuario_id, activo, credencial_hash")
            .eq("id", dispositivoId)
            .maybeSingle();

        if (error) {

            console.error("❌ [PAGOS] Error consultando dispositivo:", error.message);

            return res.status(500).json({
                success: false,
                error: "Error de autenticación"
            });

        }

        // Mismo mensaje/código para "no existe", "inactivo" y "secreto
        // incorrecto" — a propósito, para no revelar a un atacante cuál de
        // los tres casos ocurrió (no confirma ni niega la existencia de un
        // dispositivo_id).
        const credencialValida =
            !!dispositivo &&
            dispositivo.activo === true &&
            verificarCredencial(secreto, dispositivo.credencial_hash);

        if (!credencialValida) {

            return res.status(401).json({
                success: false,
                code: "CREDENCIAL_INVALIDA",
                error: "Credencial inválida o dispositivo inactivo"
            });

        }

        req.dispositivo = {
            id: dispositivo.id,
            usuarioId: dispositivo.usuario_id
        };

        next();

    } catch (err) {

        console.error("❌ [PAGOS] Error inesperado autenticando dispositivo:", err);

        return res.status(500).json({
            success: false,
            error: "Error de autenticación"
        });

    }

}

module.exports = autenticarDispositivo;
