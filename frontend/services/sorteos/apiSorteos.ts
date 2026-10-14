import { supabase } from "@/lib/supabase";

// Cliente del panel para sorteos programados, plantillas y cuentas de pago.
// Cada petición lleva el access_token de la sesión de Supabase Auth; el
// backend identifica al usuario POR ESE TOKEN (nunca se envía usuarioId).

export type EstadoSorteo = "borrador" | "programado" | "publicando" | "publicado" | "publicado_parcial" | "fallido" | "cancelado";
export type EstadoGrupo = "pendiente" | "publicando" | "publicado" | "fallido" | "requiere_revision" | "cancelado";

export interface Premio { tipo?: string; nombre: string; premio: number | null }
export interface Recordatorio { minutos_antes_cierre: number; texto: string }

export interface ConfigSorteo {
    modalidad: string;
    nombre: string;
    /** Lotería del calendario (opcional: un nombre personalizado no la lleva). */
    loteria_id?: string | null;
    hora_fin: string;
    hora_cierre: string | null;
    valor: number;
    premios: Premio[];
    grupos?: string[];
    cuentas: string[];
    publicar_en?: string | null;
    mensajes: { publicacion: string; aviso_cierre: string };
    recordatorios: Recordatorio[];
    reservas: { liberar_no_pagados: boolean; vencimiento_minutos: number | null };
    cantidad_numeros?: number;
}

export interface GrupoSorteo {
    id: string;
    grupo_id: string;
    grupo_nombre: string | null;
    estado: EstadoGrupo;
    intentos: number;
    ultimo_error: string | null;
    publicado_en: string | null;
}

export interface Sorteo {
    id: string;
    estado: EstadoSorteo;
    version: number;
    config: ConfigSorteo;
    cuentas_snapshot: CuentaPago[];
    tabla: string;
    cifras: number;
    cantidad_numeros: number;
    publicar_en: string;
    confirmado_version: number | null;
    plantilla_id: string | null;
    grupos?: GrupoSorteo[];
}

export interface VistaPrevia {
    id: string;
    version: number;
    estado: EstadoSorteo;
    publicar_en: string;
    publicacion: string;
    recordatorios: Recordatorio[];
    aviso_cierre: string | null;
    tabla: { esperados: number; presentes: number; ocupadosOtroSorteo: number; retenidos: number } | null;
    grupos: { grupo_id: string; nombre: string | null; estado: EstadoGrupo; bloqueo: string | null }[];
    bloqueos: string[];
    avisos: string[];
    variables: Record<string, string>;
    puede_confirmar: boolean;
}

export interface CuentaPago {
    id: string;
    nombre: string;
    tipo: string;
    titular: string | null;
    numero: string;
    instrucciones: string | null;
    activa?: boolean;
}

export interface Plantilla { id: string; nombre: string; config: ConfigSorteo }
export interface GrupoAutorizado { grupo_id: string; nombre: string | null }
/** registrados = filas del cliente en grupos_autorizados; autorizados = las activas. */
export interface ResumenGrupos { registrados: number; autorizados: number }

export type CategoriaLoteria = "chance" | "tradicional";
export type ReglaFestivo = "sin_regla" | "no_se_juega" | "hora_habitual" | "hora_especial";

export interface Loteria {
    id: string;
    nombre: string;
    modalidad: string;
    etiqueta: string;
    categoria: CategoriaLoteria;
    /** 1 = lunes … 7 = domingo. Vacío = sin configurar. */
    dias: number[];
    hora: string | null;
    horas_por_dia: Record<string, string>;
    regla_festivo: ReglaFestivo;
    hora_festivo: string | null;
    notas: string | null;
    activo: boolean;
}

export type LoteriaEntrada = Omit<Loteria, "id" | "etiqueta">;

export interface HorarioLoteria {
    loteria: string;
    fecha: string;
    dia_semana: number;
    dia_nombre: string;
    festivo: string | null;
    juega: boolean | null;
    hora: string | null;
    hora_del_dia: string | null;
    origen: string | null;
    avisos: string[];
}

export interface ErrorCampo { campo: string; mensaje: string }

export type Respuesta<T> =
    | { ok: true; data: T; aviso?: string; meta?: ResumenGrupos }
    | { ok: false; motivo: string; errores?: ErrorCampo[]; bloqueos?: string[]; error?: string; migracion?: string; status?: number };

const MENSAJES: Record<string, string> = {
    sin_sesion: "Tu sesión expiró. Vuelve a iniciar sesión.",
    sesion_invalida: "Tu sesión expiró. Vuelve a iniciar sesión.",
    no_encontrado: "No se encontró.",
    version_cambiada: "El sorteo cambió desde la vista previa. Revísala de nuevo.",
    estado_invalido: "El sorteo ya no se puede modificar en su estado actual.",
    ya_publicado: "Ya se publicó en algún grupo: no se puede editar.",
    bloqueado: "Hay bloqueos que impiden programarlo.",
    confirmacion_requerida: "Debes confirmar que revisaste la vista previa.",
    nombre_duplicado: "Ya existe una plantilla con ese nombre.",
    migracion_pendiente: "Esta función todavía no está disponible. Inténtalo más tarde.",
    validacion: "Revisa los campos marcados."
};

// Lo que ve el cliente cuando falla algo interno (servidor, configuración,
// base de datos): nunca detalles técnicos. Esos van a la consola.
export const ERROR_GENERICO = "No pudimos completar la operación. Inténtalo de nuevo en unos minutos.";

export function describirError(r: { motivo: string; error?: string; migracion?: string; status?: number }): string {
    const conocido = MENSAJES[r.motivo];
    if (!conocido || r.motivo === "migracion_pendiente") {
        console.warn("[EFAAT] error interno:", { motivo: r.motivo, status: r.status, migracion: r.migracion, error: r.error });
    }
    return conocido || ERROR_GENERICO;
}

export const esSesionCaducada = (r: { motivo: string }) => r.motivo === "sin_sesion" || r.motivo === "sesion_invalida";

async function llamar<T>(metodo: "GET" | "POST" | "PUT" | "PATCH", ruta: string, cuerpo?: unknown): Promise<Respuesta<T>> {

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) return { ok: false, motivo: "sin_sesion" };

    try {

        const res = await fetch(`/api/sorteos${ruta}`, {
            method: metodo,
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
            cache: "no-store"
        });

        const json = await res.json().catch(() => null);

        if (!json || typeof json.ok !== "boolean") {
            return { ok: false, motivo: json?.code || "respuesta_invalida", error: json?.error, status: res.status };
        }

        return (json.ok ? json : { ...json, status: res.status }) as Respuesta<T>;

    } catch {

        return { ok: false, motivo: "backend_no_disponible" };

    }

}

export const apiSorteos = {
    listar: () => llamar<Sorteo[]>("GET", ""),
    obtener: (id: string) => llamar<Sorteo>("GET", `/${id}`),
    crear: (config: ConfigSorteo & { plantilla_id?: string | null }) => llamar<Sorteo>("POST", "", config),
    editar: (id: string, config: ConfigSorteo & { version: number; plantilla_id?: string | null }) => llamar<Sorteo>("PUT", `/${id}`, config),
    vistaPrevia: (id: string) => llamar<VistaPrevia>("GET", `/${id}/vista-previa`),
    confirmar: (id: string, version: number) => llamar<Sorteo>("POST", `/${id}/confirmar`, { version, confirmacion: true }),
    cancelar: (id: string) => llamar<Sorteo>("POST", `/${id}/cancelar`),
    reintentarGrupo: (id: string, grupoId: string) => llamar<Sorteo>("POST", `/${id}/grupos/reintentar`, { grupo_id: grupoId }),
    grupos: () => llamar<GrupoAutorizado[]>("GET", "/grupos"),
    plantillas: () => llamar<Plantilla[]>("GET", "/plantillas"),
    crearPlantilla: (nombre: string, config: ConfigSorteo) => llamar<Plantilla>("POST", "/plantillas", { nombre, config }),
    actualizarPlantilla: (id: string, cambios: { nombre?: string; config?: ConfigSorteo; activa?: boolean }) => llamar<Plantilla>("PATCH", `/plantillas/${id}`, cambios),
    cuentas: () => llamar<CuentaPago[]>("GET", "/cuentas"),
    crearCuenta: (cuenta: Omit<CuentaPago, "id">) => llamar<CuentaPago>("POST", "/cuentas", cuenta),
    actualizarCuenta: (id: string, cambios: Partial<Omit<CuentaPago, "id">>) => llamar<CuentaPago>("PATCH", `/cuentas/${id}`, cambios),
    loterias: () => llamar<Loteria[]>("GET", "/loterias"),
    crearLoteria: (loteria: LoteriaEntrada) => llamar<Loteria>("POST", "/loterias", loteria),
    actualizarLoteria: (id: string, cambios: Partial<LoteriaEntrada>) => llamar<Loteria>("PATCH", `/loterias/${id}`, cambios),
    horarioLoteria: (id: string, fecha: string) => llamar<HorarioLoteria>("GET", `/loterias/${id}/horario?fecha=${encodeURIComponent(fecha)}`)
};
