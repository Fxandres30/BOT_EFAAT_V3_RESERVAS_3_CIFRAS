// Tipos del sistema de DISEÑOS VISUALES por tabla (Fase Tablas).
//
// Un diseño controla EXCLUSIVAMENTE presentación: colores, tipografía del
// número, geometría del grid. Nunca datos del sorteo (nombre, premio,
// valor) — esos siguen viniendo de eventos_bot vía obtenerEventoActivo(),
// ni reglas de negocio que no existan ya en el sistema real (no hay
// "ganador" ni "ocultar ocupados" reales hoy, así que no aparecen aquí).

export interface ColorCelda {
    bg: string;
    border: string;
    text: string;
}

export interface TablaDisenoConfig {
    theme: {
        pageBg: string;
        tableBg: string;
        text: string;
        border: string;
        accent: string;
    };
    cells: {
        available: ColorCelda;
        reserved: ColorCelda;
        pagado: ColorCelda;
    };
    numbers: {
        size: number; // px, tope superior de un clamp responsivo
        weight: number; // 400–800
    };
    grid: {
        radius: number; // px
        spacing: number; // px (gap)
        borderWidth: number; // px
    };
}

// Fila real de public.tabla_disenos — biblioteca reutilizable del usuario.
export interface TablaDiseno {
    id: string;
    usuario_id: string;
    nombre: string;
    config: TablaDisenoConfig;
    creado_en: string;
    actualizado_en: string;
}

// Fila real de public.tabla_configuracion_visual — asignación ACTIVA e
// independiente de una tabla (usuario + precio). Editar esto nunca
// modifica tabla_disenos ni la configuración de otro precio.
export interface TablaConfiguracionVisual {
    id: string;
    usuario_id: string;
    precio: number;
    diseno_origen_id: string | null;
    config: TablaDisenoConfig;
    creado_en: string;
    actualizado_en: string;
}
