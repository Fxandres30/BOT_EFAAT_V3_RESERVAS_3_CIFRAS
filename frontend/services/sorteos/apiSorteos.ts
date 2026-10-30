import { supabase } from "@/lib/supabase";
import type { TablaDisenoConfig } from "@/components/tablas/disenoTypes";

// Cliente del panel para sorteos programados, plantillas y cuentas de pago.
// Cada petición lleva el access_token de la sesión de Supabase Auth; el
// backend identifica al usuario POR ESE TOKEN (nunca se envía usuarioId).

export type EstadoSorteo = "borrador" | "programado" | "publicando" | "publicado" | "publicado_parcial" | "fallido" | "cancelado";
export type EstadoGrupo = "pendiente" | "publicando" | "publicado" | "fallido" | "requiere_revision" | "cancelado";

export interface Premio { tipo?: string; nombre: string; premio: number | null }
export interface Recordatorio { minutos_antes_cierre: number; texto: string }

/**
 * Estilo de la tabla del sorteo. "actual" = el diseño que la tabla de ese
 * precio ya tiene; "biblioteca" = un diseño guardado del usuario; "preset" =
 * un estilo predefinido. El backend guarda una copia (config).
 */
export interface DisenoSorteo {
    origen: "actual" | "biblioteca" | "preset";
    diseno_id: string | null;
    nombre: string | null;
    config: TablaDisenoConfig | null;
}

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
    /** Día en que se juega (YYYY-MM-DD, Colombia). Vacío = el de la publicación. */
    fecha_sorteo?: string | null;
    /** Reinicio de la tabla: solo si se elige expresamente. Los bloqueados a
     *  mano se conservan salvo liberar_bloqueados (solo con reiniciar). */
    tabla?: { reiniciar: boolean; liberar_bloqueados?: boolean };
    /** Si al publicar el grupo sigue con otro sorteo propio abierto: false =
     *  esperar a que cierre; true = sustituirlo en ese grupo. */
    sustituir_activo?: boolean;
    /** «Sorteo instantáneo»: se publica al confirmarlo (publicar-ahora). */
    publicacion_inmediata?: boolean;
    diseno?: DisenoSorteo;
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
    /** Fila de eventos_bot que creó la publicación en este grupo (el
     *  backend ya la envía: select * de sorteos_programados_grupos). */
    evento_bot_id?: string | null;
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
    confirmado_en?: string | null;
    cancelado_en?: string | null;
    ultimo_error?: string | null;
    creado_en?: string;
    actualizado_en?: string;
    /** Migración 038: oculta del listado, sin borrar nada. */
    archivado_en?: string | null;
}

/**
 * Estado OPERATIVO del sorteo, leído de eventos_bot (backend
 * sorteos/administracion.js). Distinto del estado de la programación:
 * «publicado» no significa «terminado».
 */
export type EstadoOperativo = "pendiente" | "en_curso" | "terminado" | "cancelado" | "sin_publicar" | "desconocido";

export interface GrupoGestion {
    id: string;
    grupo_id: string;
    nombre: string | null;
    estado: EstadoGrupo;
    en_espera: boolean;
    intentos: number;
    reintentos_manuales: number;
    publicado_en: string | null;
    actualizado_en: string | null;
    ultimo_error: string | null;
    /** Evento del grupo: no creado, abierto, cerrado o ya de otro sorteo. */
    evento: "sin_evento" | "abierto" | "cerrado" | "reutilizado";
    explicacion: string;
    /** Qué debe hacer el administrador, o null si nada. */
    intervencion: string | null;
    puede_reintentar: boolean;
}

export interface AccionesSorteo {
    vista_previa: boolean;
    confirmar: boolean;
    editar: boolean;
    cancelar: boolean;
    eliminar: boolean;
    archivar: boolean;
    restaurar: boolean;
}

export interface ImpactoSorteo {
    lectura_ok: boolean;
    grupos: { total: number; pendientes: number; publicando: number; publicados: number; fallidos: number; en_revision: number; cancelados: number; con_evento: number };
    intentos: number;
    reintentos_manuales: number;
    eventos: { total: number; abiertos: number };
    reservas: { reservados: number; pagados: number; otros: number; total: number };
    anticipadas: number;
    reinicio_hecho: boolean;
}

export interface GestionSorteo {
    operativo: { estado: EstadoOperativo; reservas: "abiertas" | "cerradas" | null; detalle: string };
    impacto: ImpactoSorteo;
    /** Lo que el backend permite en este estado (y vuelve a validar). */
    acciones: AccionesSorteo;
    eliminacion: { posible: boolean; bloqueos: string[]; alternativa: "cancelar" | "archivar" | null };
    grupos: GrupoGestion[];
    necesita_intervencion: boolean;
    ultimo_error: string | null;
    ultima_actualizacion: string | null;
    archivado_en: string | null;
}

export interface SorteoGestionado extends Sorteo {
    grupos: GrupoSorteo[];
    gestion: GestionSorteo;
}

export interface DetalleSorteo extends SorteoGestionado {
    historial: { en: string; tipo: string; texto: string }[];
    /** false: el historial de operaciones (migración 038) no está disponible. */
    historial_completo: boolean;
}

/** Recuento de lo que hizo una cancelación. */
export interface ResultadoCancelacion { cancelados: number; en_curso: number; publicados: number; en_revision: number; eventos_abiertos: number }

/** Campo de un sorteo activo: si se puede editar con el sorteo en curso y por qué. */
export interface CampoActivo { editable: boolean; motivo?: string; requiere_confirmacion?: boolean }

/**
 * Sorteo ACTIVO de una tabla (eventos_bot), lo haya detectado el bot o
 * creado el panel. `id` es el evento por el que se abre y se guarda.
 * cuentas/diseno/mensajes son null en los detectados (no los guardan).
 */
export interface SorteoActivo {
    id: string;
    origen: "detectado" | "panel";
    sorteo_programado_id: string | null;
    /** identidad_evento_real: une las filas (grupos) del mismo sorteo. */
    identidad?: string | null;
    nombre: string | null;
    fecha_evento: string | null;
    hora_fin: string | null;
    hora_cierre: string | null;
    valor: number | null;
    premios: Premio[];
    tabla: string | null;
    cantidad_numeros: number | null;
    estado: string | null;
    grupos: { evento_id: string; grupo_id: string; grupo_nombre: string | null; abierto: boolean }[];
    reservados: number;
    pagados: number;
    cuentas: CuentaPago[] | null;
    cuentas_ids: string[] | null;
    diseno: DisenoSorteo | null;
    mensajes: { publicacion: string; aviso_cierre: string } | null;
    /** Texto que acompaña al anuncio ("" = sin texto guardado). Panel:
     *  config.mensajes.publicacion; detectado: el escrito desde el panel. */
    publicacion: string;
    recordatorios: Recordatorio[] | null;
    campos: Record<"nombre" | "fecha_evento" | "hora_fin" | "valor" | "tabla" | "grupos" | "premios" | "hora_cierre" | "cuentas" | "diseno" | "publicacion" | "mensajes", CampoActivo>;
}

/** Lo que se puede cambiar de un sorteo activo; `base` = lo que se vio al abrirlo. */
export interface EdicionActivo {
    /** Corrección de identidad (lotería, fecha, hora, valor): exige
     *  confirmar_identidad; las reservas y pagos siguen al sorteo corregido. */
    nombre?: string;
    fecha_evento?: string;
    hora_fin?: string;
    valor?: number;
    confirmar_identidad?: boolean;
    premios?: Premio[];
    hora_cierre?: string;
    cuentas?: string[];
    diseno?: DisenoSorteo;
    publicacion?: string;
    base: { premios: Premio[]; hora_cierre: string | null; publicacion?: string };
}

/** Estado de un sorteo en un grupo, para administrarlo. */
export type EstadoEventoGrupo = "en_curso" | "cerrado" | "desactivado" | "cancelado" | "sustituido";

/** Sorteo ya en los grupos (activo o reciente) con el estado de cada grupo. */
export interface SorteoEnGrupos {
    id: string;
    identidad: string | null;
    nombre: string | null;
    fecha_evento: string | null;
    hora_fin: string | null;
    hora_cierre: string | null;
    valor: number | null;
    estado: EstadoEventoGrupo;
    reservados: number;
    pagados: number;
    grupos: { evento_id: string; grupo_id: string; grupo_nombre: string | null; estado: EstadoEventoGrupo; abierto_whatsapp: boolean }[];
}

export type AccionEvento = "cerrar" | "reabrir" | "desactivar" | "cancelar" | "eliminar";

export interface ResultadoAccionEvento {
    accion: AccionEvento;
    alcance: "grupo" | "todos";
    grupos: { evento_id: string; grupo_id: string; estado: string }[];
    whatsapp: { grupo_id: string; whatsapp: string; error?: string | null }[];
    publicaciones_detenidas: number;
}

export interface VistaPrevia {
    id: string;
    version: number;
    estado: EstadoSorteo;
    publicar_en: string;
    fecha_sorteo: string;
    hora_fin: string;
    hora_cierre: string | null;
    diseno: DisenoSorteo;
    /** Mismos datos que la imagen compartida (número + libre u ocupado). */
    numeros: { numerosDisponibles: string[]; numerosOcupados: string[] };
    cantidad_numeros: number;
    cuentas: CuentaPago[];
    reinicio: ReinicioTabla | null;
    /** Opción del formulario: «Conservar la tabla actual» (reiniciar=false) o
     *  «Reiniciar la tabla antes de publicar»; reiniciado_en si ya se hizo. */
    tabla_al_publicar?: { reiniciar: boolean; liberar_bloqueados: boolean; reiniciado_en: string | null };
    publicacion: string;
    recordatorios: Recordatorio[];
    aviso_cierre: string | null;
    tabla: { esperados: number; presentes: number; ocupadosOtroSorteo: number; retenidos: number; libres?: number; duplicados?: number } | null;
    grupos: {
        grupo_id: string;
        nombre: string | null;
        estado: EstadoGrupo;
        bloqueo: string | null;
        /** En la fecha de publicación: listo, programado (el sorteo actual
         *  cierra antes) o bloqueado por un conflicto real. */
        estado_previo: EstadoPublicacion;
        motivo: string | null;
    }[];
    bloqueos: string[];
    avisos: string[];
    variables: Record<string, string>;
    estado_publicacion: EstadoPublicacion;
    publicacion_inmediata?: boolean;
    puede_confirmar: boolean;
}

/** Resultado de «Publicar ahora»: el estado REAL de cada grupo. */
export interface ResultadoPublicacionInmediata {
    sorteo_id: string;
    estado: EstadoSorteo;
    publicados: number;
    fallidos: number;
    en_revision: number;
    pendientes: number;
    grupos: { grupo_id: string; nombre: string | null; estado: EstadoGrupo; error: string | null }[];
    /** Ya estaba confirmado (doble clic o reintento): no se publicó otra vez. */
    repetido?: boolean;
}

export type EstadoPublicacion = "listo" | "programado" | "bloqueado";

export interface ReinicioTabla {
    posible: boolean;
    /** Hoy no es posible (números del sorteo actual), pero sí al publicar:
     *  ese sorteo cierra antes (cierra_antes). Se hace al publicar. */
    diferido?: boolean;
    cierra_antes?: string;
    /** Se reiniciará al publicar (programar nunca toca la tabla): pide
     *  confirmarlo en la vista previa. */
    al_publicar?: boolean;
    /** Huella de la tabla de hoy (informativa: al publicar se vuelve a revisar). */
    huella: string | null;
    liberables: number;
    protegidos: number;
    /** Bloqueados a mano que se conservan. */
    conservados?: number;
    liberar_bloqueados?: boolean;
    se_liberarian: string[];
    se_conservan?: string[];
    bloqueos: string[];
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
    | { ok: true; data: T; aviso?: string; meta?: ResumenGrupos; resultado?: ResultadoCancelacion }
    | { ok: false; motivo: string; errores?: ErrorCampo[]; bloqueos?: string[]; error?: string; migracion?: string; status?: number; mensaje?: string; alternativa?: "cancelar" | "archivar" | null };

const MENSAJES: Record<string, string> = {
    sin_sesion: "Tu sesión expiró. Vuelve a iniciar sesión.",
    sesion_invalida: "Tu sesión expiró. Vuelve a iniciar sesión.",
    no_encontrado: "No se encontró.",
    version_cambiada: "El sorteo cambió desde la vista previa. Revísala de nuevo.",
    estado_invalido: "El sorteo ya no se puede modificar en su estado actual.",
    ya_publicado: "Ya se publicó en algún grupo: no se puede editar.",
    bloqueado: "Hay bloqueos que impiden programarlo.",
    confirmacion_requerida: "Debes confirmar que revisaste la vista previa.",
    confirmacion_reinicio_requerida: "Confirma en la vista previa que la tabla se reinicie al publicar.",
    tabla_cambio: "La tabla cambió desde la vista previa (alguien reservó o pagó). Revísala de nuevo; no se modificó nada.",
    reinicio_bloqueado: "No se pudo reiniciar la tabla: hay números protegidos. No se modificó nada.",
    nombre_duplicado: "Ya existe una plantilla con ese nombre.",
    migracion_pendiente: "Esta función todavía no está disponible. Inténtalo más tarde.",
    validacion: "Revisa los campos marcados.",
    reservas_anticipadas: "El sorteo tiene reservas anticipadas: libéralas antes desde Tablas.",
    no_eliminable: "Esta programación tiene actividad y no se puede eliminar.",
    nada_que_cancelar: "No queda nada pendiente que cancelar.",
    conflicto: "La programación cambió mientras tanto. Recarga y vuelve a intentarlo.",
    no_inmediato: "No se puede publicar ahora sin esperar a otro sorteo.",
    sin_sesion_activa: "Tu WhatsApp no está conectado: conéctalo en Sesiones. No se publicó nada.",
    sesion_no_disponible: "Tu WhatsApp está conectado en otro servidor o reconectándose. Espera un momento; no se publicó nada.",
    error_imagen: "El servidor no pudo generar la imagen de la tabla.",
    imagen_invalida: "La imagen de la tabla no es válida: no se publicó nada. Vuelve a generarla.",
    tiempo_agotado: "El servidor tardó demasiado en responder. Puede que se haya publicado: revisa el estado antes de reintentar."
};

// Rechazos que traen del servidor un mensaje concreto (cantidades, motivos).
const CON_MENSAJE = new Set(["reservas_anticipadas", "no_eliminable", "nada_que_cancelar", "estado_invalido", "no_inmediato", "error_imagen"]);

// Lo que ve el cliente cuando falla algo interno (servidor, configuración,
// base de datos): nunca detalles técnicos. Esos van a la consola.
export const ERROR_GENERICO = "No pudimos completar la operación. Inténtalo de nuevo en unos minutos.";

// Categoría técnica del fallo (solo para la consola del administrador).
export function categoriaFallo(r: { motivo: string; status?: number }): string {
    if (r.motivo === "respuesta_invalida") return r.status === 404 ? "ruta inexistente (backend o panel sin este código)" : "respuesta no válida del servidor";
    if (r.motivo === "TOKEN_SERVICIO_NO_CONFIGURADO") return "configuración: el backend no tiene token de servicio";
    if (r.motivo === "NO_AUTORIZADO") return "configuración: token de servicio distinto entre panel y backend";
    if (r.motivo === "sin_sesion" || r.motivo === "sesion_invalida") return "autenticación";
    if (r.motivo === "backend_no_disponible") return "backend no disponible";
    if (r.motivo === "migracion_pendiente") return "base de datos: migración pendiente";
    if (r.motivo === "error_supabase") return "base de datos";
    return r.status && r.status >= 500 ? "error interno del servidor" : "solicitud rechazada";
}

export function describirError(r: { motivo: string; error?: string; migracion?: string; status?: number; mensaje?: string }): string {
    if (CON_MENSAJE.has(r.motivo) && r.mensaje) return r.mensaje;
    const conocido = MENSAJES[r.motivo];
    if (!conocido || r.motivo === "migracion_pendiente") {
        console.warn("[EFAAT] error interno:", { categoria: categoriaFallo(r), motivo: r.motivo, status: r.status, migracion: r.migracion });
    }
    return conocido || ERROR_GENERICO;
}

export const esSesionCaducada = (r: { motivo: string }) => r.motivo === "sin_sesion" || r.motivo === "sesion_invalida";

async function llamar<T>(metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", ruta: string, cuerpo?: unknown): Promise<Respuesta<T>> {

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
    activos: (precio?: number) => llamar<SorteoActivo[]>("GET", `/activos${precio ? `?precio=${precio}` : ""}`),
    obtenerActivo: (id: string) => llamar<SorteoActivo>("GET", `/activos/${id}`),
    editarActivo: (id: string, cambios: EdicionActivo) => llamar<SorteoActivo>("PUT", `/activos/${id}`, cambios),
    /** Sorteos en los grupos (activos e inactivos recientes) para administrarlos. */
    eventos: () => llamar<SorteoEnGrupos[]>("GET", "/eventos"),
    accionEvento: (eventoId: string, cuerpo: { accion: AccionEvento; alcance?: "grupo" | "todos"; hora_cierre?: string; sustituir?: boolean; cerrar_grupo_whatsapp?: boolean }) =>
        llamar<ResultadoAccionEvento>("POST", `/eventos/${eventoId}/accion`, cuerpo),
    obtener: (id: string) => llamar<Sorteo>("GET", `/${id}`),
    crear: (config: ConfigSorteo & { plantilla_id?: string | null }) => llamar<Sorteo>("POST", "", config),
    editar: (id: string, config: ConfigSorteo & { version: number; plantilla_id?: string | null }) => llamar<Sorteo>("PUT", `/${id}`, config),
    vistaPrevia: (id: string) => llamar<VistaPrevia>("GET", `/${id}/vista-previa`),
    confirmar: (id: string, version: number, reinicio?: { confirmado: boolean }) =>
        llamar<Sorteo>("POST", `/${id}/confirmar`, { version, confirmacion: true, ...(reinicio ? { reinicio } : {}) }),
    cancelar: (id: string) => llamar<Sorteo>("POST", `/${id}/cancelar`),
    /** «Sorteo instantáneo»: confirma y publica YA con el publicador de siempre.
     *  `imagen`: la captura de la vista previa (capturarTabla, la de «Compartir»), que se envía tal cual. */
    publicarAhora: (id: string, version: number, imagen: string, reinicio?: { confirmado: boolean }) =>
        llamar<ResultadoPublicacionInmediata>("POST", `/${id}/publicar-ahora`, { version, confirmacion: true, imagen, ...(reinicio ? { reinicio } : {}) }),
    /** Listado de la pantalla de programados (estados, impacto y acciones). */
    gestion: () => llamar<SorteoGestionado[]>("GET", "/gestion"),
    detalle: (id: string) => llamar<DetalleSorteo>("GET", `/${id}/detalle`),
    /** Solo sin actividad; `version` = la que se vio al confirmar. */
    eliminar: (id: string, version: number) => llamar<{ id: string; eliminado: true; nombre: string | null }>("POST", `/${id}/eliminar`, { version, confirmacion: true }),
    archivar: (id: string, archivar: boolean) => llamar<Sorteo>("POST", `/${id}/archivar`, { archivar }),
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
    eliminarLoteria: (id: string) => llamar<{ id: string }>("DELETE", `/loterias/${id}`),
    horarioLoteria: (id: string, fecha: string) => llamar<HorarioLoteria>("GET", `/loterias/${id}/horario?fecha=${encodeURIComponent(fecha)}`)
};
