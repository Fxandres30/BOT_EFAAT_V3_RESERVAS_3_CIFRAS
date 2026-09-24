// ==========================================================================
// Constantes de la analítica privada. Sin variables de entorno propias:
// usa solo la conexión Supabase existente (lib/supabase.js, service role).
// ==========================================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = {
    UUID,
    // Zona horaria de "hoy"/"ayer" en el panel privado.
    ZONA_HORARIA: "America/Bogota",
    // Días que se conserva la IP completa antes de anonimizarla.
    DIAS_RETENCION_IP: 30,
    TIMEOUT_SESION_SEGUNDOS: 30 * 60,
    HEARTBEAT_MIN_SEGUNDOS: 30,
    ACTIVO_SEGUNDOS: 150
};
