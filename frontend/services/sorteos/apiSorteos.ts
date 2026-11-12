import { supabase } from "@/lib/supabase";
import { invalidar } from "@/lib/cache/almacen";
import type { TablaDisenoConfig } from "@/components/tablas/disenoTypes";
import type { PerfilCaptura } from "@/services/tablas/perfilCaptura";

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
    mensajes: MensajesSorteo;
    recordatorios: Recordatorio[];
    reservas: { liberar_no_pagados: boolean; vencimiento_minutos: number | null };
    cantidad_numeros?: number;
}

/**
 * Mensaje de publicación guardado en el sorteo: el TEXTO con {{variables}}
 * (se resuelven al publicar, con los datos reales) y sus metadatos. El
 * backend calcula personalizado, revisión y fecha; el panel solo envía el
 * estilo y si está activo.
 */
export interface MetaPublicacion {
    estilo: string;
    /** false: se publica solo la imagen; el texto sigue guardado. */
    activo: boolean;
    personalizado?: boolean;
    revision?: number;
    actualizado_en?: string | null;
}

export interface MensajesSorteo {
    publicacion: string;
    aviso_cierre: string;
    publicacion_meta?: Partial<MetaPublicacion>;
}

/** Estilo del catálogo (backend/sorteos/estilosMensaje.js). */
export interface EstiloMensaje {
    id: string;
    nombre: string;
    descripcion: string;
    /** Texto con {{variables}} que se copia al sorteo. */
    plantilla: string;
    /** La plantilla resuelta con datos de muestra (miniatura). */
    ejemplo: string;
}

export interface CatalogoEstilos {
    estilos: EstiloMensaje[];
    variables: Record<string, string>;
    /** Estilo predeterminado DE ESTA cuenta (clásico si no eligió). */
    predeterminado: string;
    /** false: falta la migración 042 (no se puede guardar la preferencia). */
    preferencias_disponibles: boolean;
    limite: number;
}

/** Datos con los que se genera la vista previa del mensaje. Cuentas: ids
 *  de cuentas propias o la copia guardada en el sorteo. */
export interface DatosMensaje {
    nombre: string;
    hora_fin: string;
    hora_cierre: string | null;
    valor: number;
    premios: Premio[];
    fecha_sorteo: string | null;
    cuentas: (string | Pick<CuentaPago, "nombre" | "numero" | "titular" | "instrucciones">)[];
    cantidad_numeros?: number | null;
}

export interface MensajeGenerado {
    estilo: string | null;
    plantilla: string;
    texto: string;
    desconocidas: string[];
    longitud: number;
    excede: boolean;
    limite: number;
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

export type EtapaPublicacion = "evento_creado" | "publicacion_enviada" | "publicacion_confirmada" | "publicacion_fallida" | "requiere_intervencion";

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
    /** Punto real de la publicación: lo que está hecho y confirmado. Opcional:
     *  un backend anterior no lo envía. */
    etapa?: EtapaPublicacion | EstadoGrupo;
    resumen?: string;
    explicacion: string;
    /** Qué debe hacer el administrador, o null si nada. */
    intervencion: string | null;
    puede_reintentar: boolean;
}

export interface AccionesSorteo {
    vista_previa: boolean;
    /** Programado en borrador: «Revisar y confirmar». */
    confirmar: boolean;
    /** Instantáneo en borrador: «Publicar ahora». Opcional: un backend anterior no lo envía. */
    publicar_ahora?: boolean;
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
    /** `bloqueos` son esperas; la decisión de eliminar es del administrador.
     *  Opcionales: un backend anterior no los envía. */
    eliminacion: { posible: boolean; bloqueos: string[]; alternativa: "cancelar" | "archivar" | null; avisos?: string[]; con_actividad?: boolean; borra?: string[]; conserva?: string[] };
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
    /** Motor de rifas independientes: la rifa del sorteo (null en el motor de siempre). */
    tabla_id?: string | null;
    cantidad_numeros: number | null;
    estado: string | null;
    grupos: { evento_id: string; grupo_id: string; grupo_nombre: string | null; abierto: boolean }[];
    /** null = no se pudieron contar en este momento (nunca se muestra 0). */
    reservados: number | null;
    pagados: number | null;
    cuentas: CuentaPago[] | null;
    cuentas_ids: string[] | null;
    diseno: DisenoSorteo | null;
    mensajes: MensajesSorteo | null;
    /** Texto que acompaña al anuncio ("" = sin texto guardado). Panel:
     *  config.mensajes.publicacion; detectado: el escrito desde el panel. */
    publicacion: string;
    /** Texto que de verdad se publica (panel: el guardado o, en un sorteo
     *  antiguo sin texto, la plantilla de su estilo). */
    publicacion_texto?: string;
    publicacion_meta?: MetaPublicacion;
    recordatorios: Recordatorio[] | null;
    /** Solo sorteos del panel: TODOS sus grupos (también los pendientes de
     *  publicar) según su programación, la fuente de verdad de los grupos. */
    destinos?: DestinoSorteo[] | null;
    /** Solo tras guardar una edición que cambió grupos. */
    cambios_grupos?: CambiosGrupos;
    campos: Record<"nombre" | "fecha_evento" | "hora_fin" | "valor" | "tabla" | "grupos" | "premios" | "hora_cierre" | "cuentas" | "diseno" | "publicacion" | "mensajes", CampoActivo>;
}

/** Un grupo del sorteo y el estado de su publicación. */
export interface DestinoSorteo { grupo_id: string; grupo_nombre: string | null; estado: EstadoGrupo; error: string | null }

/** Qué cambió al guardar los grupos (no publica nada). */
export interface CambiosGrupos {
    agregados: { grupo_id: string; nombre: string | null; estado: string }[];
    quitados: { grupo_id: string; nombre: string | null; estaba: string }[];
    desactivados: { grupo_id: string; nombre: string | null; evento_id: string }[];
    /** Grupos nuevos de un sorteo ya publicado: se publican con publicarGruposNuevos. */
    por_publicar: number;
    avisos: string[];
}

/** Resultado de publicar en los grupos nuevos. */
export interface ResultadoGruposNuevos {
    sorteo_id: string;
    estado: EstadoSorteo;
    publicados: number;
    pendientes: number;
    fallidos: number;
    en_revision: number;
    grupos: { grupo_id: string; nombre: string | null; estado: EstadoGrupo; error: string | null }[];
    publicados_ahora?: string[];
    nada_que_publicar?: boolean;
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
    publicacion_meta?: { estilo?: string; activo?: boolean };
    /** Selección COMPLETA de grupos (solo sorteos del panel). Guardar no publica. */
    grupos?: string[];
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
    /** null = no se pudieron contar en este momento (nunca se muestra 0). */
    reservados: number | null;
    pagados: number | null;
    /** Permiso de reservas (F3-E): decisión del administrador, aparte del
     *  estado. Opcional: un backend anterior no lo envía. */
    reservas_modo?: ModoReservas;
    /** ¿Acepta reservas nuevas ahora? (estado + permiso + hora de cierre). */
    acepta_reservas?: boolean;
    grupos: { evento_id: string; grupo_id: string; grupo_nombre: string | null; estado: EstadoEventoGrupo; abierto_whatsapp: boolean; reservas_modo?: ModoReservas }[];
}

/** Permiso de reservas del sorteo (backend shared/eventos/estadosGestion.js). */
export type ModoReservas = "segun_estado" | "permitidas" | "desactivadas";

export const ETIQUETA_MODO_RESERVAS: Record<ModoReservas, string> = {
    segun_estado: "Según el estado (abierto: sí · cerrado: no)",
    permitidas: "Permitidas (también con el sorteo cerrado)",
    desactivadas: "Desactivadas"
};

export type AccionEvento = "cerrar" | "reabrir" | "desactivar" | "cancelar" | "eliminar";

export interface ResultadoAccionEvento {
    accion: AccionEvento;
    alcance: "grupo" | "todos";
    grupos: { evento_id: string; grupo_id: string; estado: string }[];
    whatsapp: { grupo_id: string; whatsapp: string; error?: string | null }[];
    publicaciones_detenidas: number;
}

/** Captura PNG de la vista previa (capturarTabla) + huella de los números que pinta. */
export interface CapturaSorteo { imagen: string; huella: string }

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
    numeros: { numerosDisponibles: string[]; numerosOcupados: string[]; numerosPagados?: string[] };
    /** Huella de `numeros`: va con la captura al confirmar o reintentar un programado. Opcional: un backend anterior no la envía. */
    huella_tabla?: string;
    cantidad_numeros: number;
    cuentas: CuentaPago[];
    reinicio: ReinicioTabla | null;
    /** Opción del formulario: «Conservar la tabla actual» (reiniciar=false) o
     *  «Reiniciar la tabla antes de publicar»; reiniciado_en si ya se hizo. */
    tabla_al_publicar?: { reiniciar: boolean; liberar_bloqueados: boolean; reiniciado_en: string | null };
    publicacion: string;
    /** false: el mensaje está desactivado y se publica solo la imagen. */
    publicacion_activa?: boolean;
    publicacion_estilo?: string;
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
    /** semanal | mensual (mensual: la fuente no dice qué día del mes). */
    frecuencia: FrecuenciaLoteria;
    /** Tiene configuración inicial a la que volver con «Restaurar». */
    restaurable?: boolean;
    /** Próximo sorteo en hora de Colombia, solo si se puede determinar. */
    proximo?: ProximoSorteo | null;
    /** Por qué no hay próximo sorteo (mensual, inactiva, sin horario…). */
    proximo_nota?: string | null;
}

export type FrecuenciaLoteria = "semanal" | "mensual";

export interface ProximoSorteo {
    fecha: string;
    hora: string;
    dia_nombre: string;
    festivo: string | null;
    /** La hora sale de una regla no definida en la fuente: confirmarla. */
    confirmar: boolean;
}

export type LoteriaEntrada = Omit<Loteria, "id" | "etiqueta" | "restaurable" | "proximo" | "proximo_nota">;

export interface ResultadoRestaurar { restauradas: number; agregadas: number; conservadas: number }

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
    frecuencia?: FrecuenciaLoteria;
    /** La hora sugerida no sale de una regla explícita: confirmarla. */
    confirmar?: boolean;
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
    confirmacion_actividad_requerida: "Esta programación tiene actividad: revisa lo que implica y confírmalo para eliminarla.",
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
    tabla_cambiada: "La tabla cambió mientras revisabas la vista previa. Ciérrala y vuelve a abrirla para capturar la imagen actual.",
    tiempo_agotado: "El servidor tardó demasiado en responder. Puede que se haya publicado: revisa el estado antes de reintentar."
};

// Rechazos que traen del servidor un mensaje concreto (cantidades, motivos).
const CON_MENSAJE = new Set(["reservas_anticipadas", "no_eliminable", "nada_que_cancelar", "estado_invalido", "no_inmediato", "error_imagen", "tabla_cambiada"]);

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

// Cualquier operación que modifica (aunque falle a medias) deja el estado de
// sorteos del índice de Reservas como no vigente: al volver se revalida.
// Sufijo de services/tablas/indiceSorteos.ts (no se importa: evita el ciclo).
function olvidarIndice(metodo: string) {
    if (metodo !== "GET") invalidar((c) => c.endsWith("|indiceSorteos"));
}

async function llamar<T>(metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", ruta: string, cuerpo?: unknown): Promise<Respuesta<T>> {
    try {
        return await llamarServidor<T>(metodo, ruta, cuerpo);
    } finally {
        olvidarIndice(metodo);
    }
}

async function llamarServidor<T>(metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", ruta: string, cuerpo?: unknown): Promise<Respuesta<T>> {

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
    /** Sorteo detectado en WhatsApp → gestionarlo desde el panel (misma identidad, tabla y reservas; no envía nada). */
    vincularDetectado: (id: string, cuentas: string[]) => llamar<{ sorteo_programado_id: string; ya_existia: boolean }>("POST", `/activos/${id}/vincular`, { cuentas }),
    /** Sorteos en los grupos (activos e inactivos recientes) para administrarlos. */
    eventos: () => llamar<SorteoEnGrupos[]>("GET", "/eventos"),
    accionEvento: (eventoId: string, cuerpo: { accion: AccionEvento; alcance?: "grupo" | "todos"; hora_cierre?: string; sustituir?: boolean; cerrar_grupo_whatsapp?: boolean }) =>
        llamar<ResultadoAccionEvento>("POST", `/eventos/${eventoId}/accion`, cuerpo),
    /** Permiso de reservas del sorteo en todos sus grupos (F3-E). */
    permisoReservas: (eventoId: string, modo: ModoReservas) =>
        llamar<{ reservas_modo: ModoReservas; grupos: { evento_id: string; grupo_id: string; reservas_modo: ModoReservas }[] }>("PUT", `/eventos/${eventoId}/reservas`, { modo }),
    obtener: (id: string) => llamar<Sorteo>("GET", `/${id}`),
    // solicitud_id (F4-F, opcional): la misma solicitud crea UN solo borrador;
    // repetirla (doble clic, respuesta perdida) devuelve ese mismo borrador.
    crear: (config: ConfigSorteo & { plantilla_id?: string | null; solicitud_id?: string }) => llamar<Sorteo>("POST", "", config),
    editar: (id: string, config: ConfigSorteo & { version: number; plantilla_id?: string | null }) => llamar<Sorteo>("PUT", `/${id}`, config),
    vistaPrevia: (id: string) => llamar<VistaPrevia>("GET", `/${id}/vista-previa`),
    /** `imagen`: la captura de la vista previa (la misma que publica el instantáneo) y la huella de
     *  sus números; el backend la guarda y la publica a la hora si la tabla no cambió. */
    confirmar: (id: string, version: number, reinicio?: { confirmado: boolean }, captura?: PerfilCaptura, imagen?: CapturaSorteo) =>
        llamar<Sorteo>("POST", `/${id}/confirmar`, { version, confirmacion: true, ...(reinicio ? { reinicio } : {}), ...(captura ? { captura } : {}), ...(imagen ? { imagen: imagen.imagen, huella: imagen.huella } : {}) }),
    cancelar: (id: string) => llamar<Sorteo>("POST", `/${id}/cancelar`),
    /** «Sorteo instantáneo»: confirma y publica YA con el publicador de siempre.
     *  `imagen`: la captura de la vista previa (capturarTabla, la de «Compartir»), que se envía tal cual.
     *  `captura`: su perfil, para que los reintentos del servidor salgan iguales. */
    publicarAhora: (id: string, version: number, imagen: string, reinicio?: { confirmado: boolean }, captura?: PerfilCaptura, huella?: string) =>
        llamar<ResultadoPublicacionInmediata>("POST", `/${id}/publicar-ahora`, { version, confirmacion: true, imagen, ...(huella ? { huella } : {}), ...(reinicio ? { reinicio } : {}), ...(captura ? { captura } : {}) }),
    /** Listado de la pantalla de programados (estados, impacto y acciones). */
    gestion: () => llamar<SorteoGestionado[]>("GET", "/gestion"),
    detalle: (id: string) => llamar<DetalleSorteo>("GET", `/${id}/detalle`),
    /** `version` = la que se vio al confirmar. `actividad`: el administrador aceptó los avisos de una programación con actividad. */
    eliminar: (id: string, version: number, actividad = false) => llamar<{ id: string; eliminado: true; nombre: string | null }>("POST", `/${id}/eliminar`, { version, confirmacion: true, ...(actividad ? { confirmacion_actividad: true } : {}) }),
    archivar: (id: string, archivar: boolean) => llamar<Sorteo>("POST", `/${id}/archivar`, { archivar }),
    /** Grupos del sorteo: guarda la selección completa sin publicar. */
    cambiarGrupos: (id: string, grupos: string[]) => llamar<CambiosGrupos>("PUT", `/${id}/grupos`, { grupos }),
    /** Publica ahora SOLO en los grupos nuevos (pendientes) de un sorteo ya publicado. */
    /** `imagen`: captura de la tabla del sorteo (capturaSorteo.tsx); se guarda y se publica con ella. */
    publicarGruposNuevos: (id: string, imagen?: CapturaSorteo) =>
        llamar<ResultadoGruposNuevos>("POST", `/${id}/grupos/publicar`, imagen ? { imagen: imagen.imagen, huella: imagen.huella } : {}),
    /** `imagen`: captura nueva de la tabla; ese destino se publica en el momento con ella. */
    reintentarGrupo: (id: string, grupoId: string, imagen?: CapturaSorteo) =>
        llamar<Sorteo>("POST", `/${id}/grupos/reintentar`, { grupo_id: grupoId, ...(imagen ? { imagen: imagen.imagen, huella: imagen.huella } : {}) }),
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
    restaurarLoteria: (id: string) => llamar<Loteria>("POST", `/loterias/${id}/restaurar`),
    restaurarLoterias: () => llamar<ResultadoRestaurar>("POST", "/loterias/restaurar"),
    /** Catálogo de estilos del mensaje y el predeterminado de la cuenta. */
    estilosMensaje: () => llamar<CatalogoEstilos>("GET", "/estilos-mensaje"),
    guardarEstiloPredeterminado: (estilo: string) => llamar<{ estilo: string; disponible: boolean }>("PUT", "/estilos-mensaje/predeterminado", { estilo }),
    /** Vista previa: el MISMO generador que el publicador. Nunca envía nada. */
    generarMensaje: (cuerpo: { estilo?: string; texto?: string; datos: DatosMensaje }) => llamar<MensajeGenerado>("POST", "/mensaje/generar", cuerpo),
    horarioLoteria: (id: string, fecha: string) => llamar<HorarioLoteria>("GET", `/loterias/${id}/horario?fecha=${encodeURIComponent(fecha)}`)
};
