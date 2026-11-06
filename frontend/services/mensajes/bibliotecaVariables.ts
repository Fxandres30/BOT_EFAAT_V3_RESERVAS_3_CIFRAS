// ==========================================================================
// BIBLIOTECA VISUAL DE VARIABLES — capa de PRESENTACIÓN del editor de
// Mensajes.
//
// No define variables nuevas ni cambia ninguna clave: toma el catálogo real
// (catalogoVariablesGlobal.ts, espejo del backend) y las variables propias
// de cada tipo (tiposMensaje.ts) y les da un nombre comprensible, una
// agrupación y un aviso de disponibilidad. Lo que se inserta en la
// plantilla es SIEMPRE el código real "{{clave}}" que el backend ya
// entiende.
// ==========================================================================

import { TipoMensaje } from "./tiposMensaje";
import {
    CATEGORIAS,
    CategoriaVariable,
    VariableGlobal,
    listarCatalogo,
    resolverClaveCanonica
} from "./catalogoVariablesGlobal";

// Nombres pensados para alguien que nunca vio el código. La clave es la
// variable real; si falta alguna, se usa su descripción del catálogo.
const NOMBRES: Record<string, string> = {
    cliente: "Nombre del cliente",
    telefono: "Teléfono del cliente",
    numeros_solicitados: "Números solicitados",
    numeros_reservados: "Números reservados",
    numeros_pagados: "Números pagados",
    numeros_pendientes: "Números pendientes de pago",
    numeros_totales_cliente: "Todos los números del cliente",
    cantidad: "Cantidad de números",
    cantidad_reservados: "Cantidad reservada",
    cantidad_pagados: "Cantidad de números pagados",
    cantidad_pendientes: "Cantidad de números pendientes",
    numeros_disponibles: "Números disponibles",
    numeros_ocupados: "Números ocupados",
    cantidad_disponibles: "Cantidad de números disponibles",
    cantidad_ocupados: "Cantidad de números ocupados",
    precio: "Precio por número",
    monto_total: "Valor total",
    monto_pagado: "Valor pagado",
    monto_pendiente: "Valor pendiente",
    evento: "Nombre del evento",
    premio: "Premio",
    fecha: "Fecha",
    hora: "Hora",
    hora_cierre: "Hora de cierre (24 h)",
    numero_numeros: "«número» o «números»",
    tu_numero_tus_numeros: "«tu número» o «tus números»",
    su_numero_sus_numeros: "«su número» o «sus números»",
    el_numero_los_numeros: "«el número» o «los números»",
    ese_esos: "«ese número» o «esos números»",
    esta_estan: "«está» o «están»",
    estaba_estaban: "«estaba» o «estaban»",
    es_son: "«es» o «son»",
    reservado_reservados: "«reservado» o «reservados»",
    ocupado_ocupados: "«ocupado» o «ocupados»",
    disponible_disponibles: "«disponible» o «disponibles»",
    libre_libres: "«libre» o «libres»",
    quedo_quedaron: "«quedó» o «quedaron»",
    queda_quedan: "«queda» o «quedan»",
    tuyo_tuyos: "«tuyo» o «tuyos»"
};

const NOMBRE_CONJUNTO: Record<string, string> = {
    reservados: "reservados",
    ocupados: "ocupados",
    disponibles: "disponibles"
};

// Orden de prioridad de la fila principal (las más usadas).
export const CLAVES_PRINCIPALES = [
    "cliente",
    "telefono",
    "numeros_solicitados",
    "numeros_reservados",
    "cantidad_reservados",
    "cantidad",
    "evento",
    "premio",
    "fecha",
    "hora",
    "precio"
];

// Qué contexto real puede ofrecer cada tipo — mismo criterio que usaba el
// indicador 🟢/⚪ del autocompletado del editor.
export function construirContextoDisponible(tipo: TipoMensaje): Record<string, boolean> {

    if (tipo.categoria === "Reservas") {
        return { usuario: true, evento: true, reserva: true, consulta: false, estado_pago: false };
    }

    if (tipo.categoria === "Consultas") {
        // "mis números" también trae el desglose pagados/pendientes
        // (resumen del backend, resolverConsulta.js).
        const esPago = tipo.id.startsWith("consulta_pago") || tipo.id === "multiple" ||
            tipo.id === "mis_numeros";
        return { usuario: true, evento: true, reserva: false, consulta: true, estado_pago: esPago };
    }

    return { usuario: false, evento: false, reserva: false, consulta: false, estado_pago: false };

}

const REQUISITO_LEGIBLE: Record<string, string> = {
    usuario: "un cliente identificado",
    evento: "un sorteo activo",
    reserva: "una reserva",
    consulta: "una consulta",
    estado_pago: "una consulta de pagos"
};

export type Disponibilidad = "esta_respuesta" | "segun_cantidad" | "disponible" | "personalizada" | "puede_vacia";

export interface EntradaBiblioteca {
    clave: string;          // variable real: se inserta como {{clave}}
    nombre: string;         // texto del botón
    descripcion: string;
    ejemplo: string;
    grupo: string;          // título del grupo en «Más variables»
    disponibilidad: Disponibilidad;
    textoDisponibilidad: string;
    delTipo: boolean;       // la declara el propio tipo de respuesta
    gramatica: boolean;     // cambia de forma según la cantidad
}

export const GRUPO_PALABRAS = "Palabras que cambian según la cantidad";
export const GRUPO_SUGERIDAS = "Sugeridas para esta respuesta";

function nombreDe(clave: string, definicion?: VariableGlobal | null, etiquetaTipo?: string): string {

    if (NOMBRES[clave]) return NOMBRES[clave];

    const resuelta = resolverClaveCanonica(clave);

    // Forma sufijada "<base>_<conjunto>" (p. ej. ocupado_ocupados_ocupados).
    if (resuelta?.esGramaticaPorConjunto && resuelta.conjunto) {
        const base = NOMBRES[resuelta.definicion.key] || resuelta.definicion.key;
        return `${base} (solo ${NOMBRE_CONJUNTO[resuelta.conjunto] || resuelta.conjunto})`;
    }

    if (etiquetaTipo) return etiquetaTipo;
    if (definicion?.dinamica) return definicion.description || clave;

    return definicion?.description || clave;

}

function explicarDisponibilidad(
    definicion: VariableGlobal | null,
    delTipo: boolean,
    contexto: Record<string, boolean>
): { disponibilidad: Disponibilidad; texto: string } {

    if (definicion?.dinamica) {
        return { disponibilidad: "personalizada", texto: "Variable personalizada, creada en «Variables globales»." };
    }

    if (definicion?.type === "concordancia") {
        return { disponibilidad: "segun_cantidad", texto: "Se ajusta sola a 1 o a varios números." };
    }

    if (delTipo) {
        return { disponibilidad: "esta_respuesta", texto: "Se completa con datos reales en esta respuesta." };
    }

    const requisitos = definicion?.requires || [];
    const faltan = requisitos.filter((r) => contexto[r] === false);

    if (faltan.length === 0) {
        return { disponibilidad: "disponible", texto: "Disponible en esta respuesta." };
    }

    const lista = faltan.map((r) => REQUISITO_LEGIBLE[r] || r).join(" y ");

    return {
        disponibilidad: "puede_vacia",
        texto: `Puede quedar vacía aquí: solo se llena cuando hay ${lista}.`
    };

}

// Biblioteca completa para un tipo: TODAS las variables del catálogo
// (estáticas + personalizadas) más las propias del tipo que no figuran en
// el catálogo (formas sufijadas). Nunca se omite ninguna.
export function construirBiblioteca(tipo: TipoMensaje, dinamicas: VariableGlobal[] = []): EntradaBiblioteca[] {

    const contexto = construirContextoDisponible(tipo);
    const clavesDelTipo = new Set(tipo.variables.map((v) => v.variable));
    const etiquetaTipo = new Map(tipo.variables.map((v) => [v.variable, v.etiqueta]));

    // Un alias declarado por el tipo (p. ej. "loteria") marca también su
    // variable canónica como propia del tipo.
    for (const v of tipo.variables) {
        const canonica = resolverClaveCanonica(v.variable, dinamicas)?.definicion.key;
        if (canonica && canonica !== v.variable && !resolverClaveCanonica(v.variable)?.esGramaticaPorConjunto) {
            clavesDelTipo.add(canonica);
        }
    }

    const entradas: EntradaBiblioteca[] = [];
    const vistas = new Set<string>();

    const agregar = (clave: string, definicion: VariableGlobal | null) => {

        if (vistas.has(clave)) return;
        vistas.add(clave);

        const delTipo = clavesDelTipo.has(clave);
        const gramatica = definicion?.type === "concordancia" && !definicion.dinamica;
        const { disponibilidad, texto } = explicarDisponibilidad(definicion, delTipo, contexto);

        const categoria: CategoriaVariable = definicion?.categoria || "SISTEMA";

        let grupo = CATEGORIAS[categoria]?.label || "Otras";
        if (gramatica) grupo = delTipo ? GRUPO_SUGERIDAS : GRUPO_PALABRAS;

        entradas.push({
            clave,
            nombre: nombreDe(clave, definicion, etiquetaTipo.get(clave)),
            descripcion: definicion?.description || etiquetaTipo.get(clave) || "",
            ejemplo: definicion?.example || "",
            grupo,
            disponibilidad,
            textoDisponibilidad: texto,
            delTipo,
            gramatica
        });

    };

    for (const definicion of listarCatalogo(dinamicas)) {
        agregar(definicion.key, definicion);
    }

    // Propias del tipo que el catálogo no lista por clave (sufijadas).
    for (const v of tipo.variables) {
        if (vistas.has(v.variable)) continue;
        const resuelta = resolverClaveCanonica(v.variable, dinamicas);
        if (!resuelta || resuelta.definicion.key === v.variable) {
            agregar(v.variable, resuelta?.definicion || null);
            continue;
        }
        if (resuelta.esGramaticaPorConjunto) {
            agregar(v.variable, resuelta.definicion);
        }
        // Un alias ("loteria") ya está representado por su canónica.
    }

    return entradas;

}

// Fila principal: las más usadas que tienen sentido en este tipo, y luego
// el resto de datos propios del tipo (p. ej. montos en consultas de pago).
// Las palabras según cantidad van en «Más variables».
export function variablesPrincipales(biblioteca: EntradaBiblioteca[]): EntradaBiblioteca[] {

    const porClave = new Map(biblioteca.map((e) => [e.clave, e]));
    const elegidas: EntradaBiblioteca[] = [];

    for (const clave of CLAVES_PRINCIPALES) {
        const e = porClave.get(clave);
        if (e && (e.delTipo || e.disponibilidad === "disponible")) elegidas.push(e);
    }

    for (const e of biblioteca) {
        if (e.delTipo && !e.gramatica && !elegidas.includes(e)) elegidas.push(e);
    }

    return elegidas;

}

function normalizar(texto: string): string {
    return (texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function buscarEnBiblioteca(biblioteca: EntradaBiblioteca[], consulta: string): EntradaBiblioteca[] {

    const q = normalizar(consulta.trim()).replace(/[{}]/g, "");

    if (!q) return biblioteca;

    return biblioteca.filter((e) =>
        normalizar(e.nombre).includes(q) ||
        normalizar(e.clave).includes(q) ||
        normalizar(e.descripcion).includes(q) ||
        normalizar(e.grupo).includes(q)
    );

}

// Agrupa respetando un orden estable: sugeridas del tipo primero, luego
// las categorías del catálogo y al final las palabras según cantidad.
export function agruparBiblioteca(entradas: EntradaBiblioteca[]): { grupo: string; entradas: EntradaBiblioteca[] }[] {

    const orden = [
        GRUPO_SUGERIDAS,
        ...Object.values(CATEGORIAS).map((c) => c.label),
        GRUPO_PALABRAS
    ];

    const mapa = new Map<string, EntradaBiblioteca[]>();

    for (const e of entradas) {
        if (!mapa.has(e.grupo)) mapa.set(e.grupo, []);
        mapa.get(e.grupo)!.push(e);
    }

    return [...mapa.entries()]
        .sort(([a], [b]) => {
            const ia = orden.indexOf(a);
            const ib = orden.indexOf(b);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        })
        .map(([grupo, lista]) => ({ grupo, entradas: lista }));

}

const REGEX_VARIABLE = /\{\{\s*(\w+)(?:\|(\w+))?\s*\}\}/g;

export interface VariableUsada {
    clave: string;
    nombre: string;
    conocida: boolean;
}

// Variables que aparecen en un texto, con su nombre comprensible (sin
// repetir). Sirve para mostrar «Información automática en este mensaje».
export function variablesUsadas(texto: string, dinamicas: VariableGlobal[] = [], tipo?: TipoMensaje): VariableUsada[] {

    const vistas = new Set<string>();
    const resultado: VariableUsada[] = [];
    const etiquetaTipo = new Map((tipo?.variables || []).map((v) => [v.variable, v.etiqueta]));

    for (const m of (texto || "").matchAll(REGEX_VARIABLE)) {

        const clave = m[1];
        if (vistas.has(clave)) continue;
        vistas.add(clave);

        const resuelta = resolverClaveCanonica(clave, dinamicas);

        resultado.push({
            clave,
            nombre: resuelta
                ? (NOMBRES[clave] ? NOMBRES[clave]
                    : resuelta.esGramaticaPorConjunto ? nombreDe(clave, resuelta.definicion)
                        : NOMBRES[resuelta.definicion.key] || nombreDe(clave, resuelta.definicion, etiquetaTipo.get(clave)))
                : clave,
            conocida: !!resuelta
        });

    }

    return resultado;

}

// Versión legible de un contenido para listados: «{{cliente}}» se muestra
// como «[Nombre del cliente]». Solo presentación; nunca se guarda.
export function contenidoLegible(texto: string, dinamicas: VariableGlobal[] = [], tipo?: TipoMensaje): string {

    const nombres = new Map(variablesUsadas(texto, dinamicas, tipo).map((v) => [v.clave, v.nombre]));

    return (texto || "").replace(REGEX_VARIABLE, (_m, clave: string) => `[${nombres.get(clave) || clave}]`);

}

// ¿Hace falta un espacio antes de insertar? Sí tras una palabra o un signo
// de cierre («Hola», «*Hola*», «números:»); no al inicio de línea, tras un
// espacio, tras un signo de apertura («(», «¡», «"») ni tras un marcador de
// formato que abre («*» precedido de espacio → «*{{cliente}}*»).
function necesitaEspacio(anterior: string): boolean {

    const c = anterior.slice(-1);

    if (!c || /\s/.test(c)) return false;
    if ("([{¡¿«\"'“‘".includes(c)) return false;

    if ("*_~".includes(c)) {
        const previo = anterior.slice(-2, -1);
        return !!previo && !/\s/.test(previo) && !"*_~".includes(previo);
    }

    return true;

}

// Texto a insertar en la posición del cursor. Agrega un espacio antes si
// la variable quedaría pegada al texto anterior («Hola{{cliente}}»).
export function insertarEnTexto(
    texto: string,
    inicio: number,
    fin: number,
    inserto: string,
    separarDePalabra = true
): { texto: string; cursor: number } {

    const anterior = texto.slice(0, inicio);
    const prefijo = separarDePalabra && necesitaEspacio(anterior) ? " " : "";
    const nuevo = anterior + prefijo + inserto + texto.slice(fin);

    return { texto: nuevo, cursor: inicio + prefijo.length + inserto.length };

}

// Envuelve la selección con un marcador de formato de WhatsApp (*, _, ~).
// Sin selección inserta el par y deja el cursor en medio.
export function envolverSeleccion(
    texto: string,
    inicio: number,
    fin: number,
    marca: string
): { texto: string; inicio: number; fin: number } {

    const seleccion = texto.slice(inicio, fin);

    // WhatsApp no aplica el formato si el marcador toca un espacio: se
    // dejan los espacios de los extremos fuera del marcador.
    const espaciosIni = seleccion.length - seleccion.trimStart().length;
    const espaciosFin = seleccion.length - seleccion.trimEnd().length;
    const nucleo = seleccion.trim();

    if (!nucleo) {
        const nuevo = texto.slice(0, inicio) + marca + marca + texto.slice(fin);
        return { texto: nuevo, inicio: inicio + marca.length, fin: inicio + marca.length };
    }

    const a = inicio + espaciosIni;
    const b = fin - espaciosFin;
    const nuevo = texto.slice(0, a) + marca + nucleo + marca + texto.slice(b);

    return { texto: nuevo, inicio: a + marca.length, fin: b + marca.length };

}
