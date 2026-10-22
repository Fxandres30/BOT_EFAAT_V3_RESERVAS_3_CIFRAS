// ==========================================================================
// Ayudante de PRUEBAS — política de grupos autorizados permisiva.
//
// Para suites anteriores a la política (aperturas, cierres, avisos, ciclo de
// vida de sesiones…) cuyos Supabase simulados no tienen grupos_autorizados:
// autoriza cualquier grupo SIEMPRE QUE haya dueño (sin dueño sigue
// rechazando, como la real). La política real se prueba en
// tests/seguridad/aislamientoMensajesGrupo.test.js.
//
//     require("../utils/politicaGruposPermisiva");   // antes de cargar el bot
// ==========================================================================

const path = require("path");

const ruta = path.resolve(__dirname, "../../bot/funciones/grupos/politicaGrupos.js");

require.cache[ruta] = {
    id: ruta,
    filename: ruta,
    loaded: true,
    exports: {
        AUTORIZACION_TTL_MS: 0,
        evaluarGrupo: async (usuarioId, grupoId) => {
            if (!usuarioId) return { permitido: false, motivo: "sin_propietario" };
            if (!grupoId) return { permitido: false, motivo: "sin_grupo" };
            return { permitido: true, motivo: "autorizado" };
        },
        gruposAutorizadosDe: async (usuarioId) => (usuarioId ? { has: () => true } : null),
        olvidarAutorizacion: () => {}
    }
};
