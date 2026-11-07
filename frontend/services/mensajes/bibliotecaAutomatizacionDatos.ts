// ==========================================================================
// Biblioteca de mensajes de automatización — acceso a datos.
//
// Solo REUTILIZA los servicios que ya existen, cada uno con su tabla:
//   automation_messages → services/automatizacion/mensajesAutomation.ts
//   plantillas_mensaje (inicio_dia) → services/mensajes/plantillas.ts
// Sin tablas nuevas, sin mover filas, sin cambiar ids. Mismas reglas de
// siempre (RLS): los mensajes «De EFAAT» no se editan, se duplican.
// ==========================================================================

import {
    AutomationMessage,
    listarMensajes,
    crearMensaje,
    actualizarMensaje,
    alternarActivo,
    duplicarMensaje,
    eliminarMensaje
} from "@/services/automatizacion/mensajesAutomation";
import {
    PlantillaMensaje,
    listarPlantillas,
    crearPlantilla,
    actualizarPlantilla,
    alternarHabilitada,
    duplicarPlantilla,
    eliminarPlantilla,
    valoresPorDefectoVariables
} from "@/services/mensajes/plantillas";
import {
    MensajeBiblioteca,
    FiltrosBiblioteca,
    TIPO_INICIO_DIA,
    desdeAutomatizacion,
    desdeInicioDia,
    filtrarYOrdenar,
    fuentesParaFiltro,
    origenDeTipo
} from "./bibliotecaAutomatizacion";

export type FilaBiblioteca = AutomationMessage | PlantillaMensaje;
export type ElementoBiblioteca = MensajeBiblioteca<FilaBiblioteca>;

interface Resultado<T> { data: T | null; error: string | null }

const fallo = (error: { message?: string } | null | undefined, texto: string) => (error ? `${texto} (${error.message || "error"})` : null);

export async function listarBiblioteca(usuarioId: string, filtros: FiltrosBiblioteca = {}): Promise<Resultado<ElementoBiblioteca[]>> {

    const fuentes = fuentesParaFiltro(filtros.tipo);

    const [auto, inicio] = await Promise.all([
        fuentes.automatizacion ? listarMensajes(usuarioId, { tipo: filtros.tipo || undefined, estado: filtros.estado }) : Promise.resolve({ data: [], error: null }),
        fuentes.inicioDia ? listarPlantillas(usuarioId, TIPO_INICIO_DIA) : Promise.resolve({ data: [], error: null })
    ]);

    const error = fallo(auto.error, "Mensajes de automatización") || fallo(inicio.error, "Inicio del día");
    if (error) return { data: null, error };

    const todos: ElementoBiblioteca[] = [
        ...((auto.data || []) as AutomationMessage[]).map((m) => desdeAutomatizacion(m) as ElementoBiblioteca),
        ...((inicio.data || []) as PlantillaMensaje[]).map((p) => desdeInicioDia(p) as ElementoBiblioteca)
    ];

    return { data: filtrarYOrdenar(todos, filtros), error: null };

}

export interface DatosEdicion { nombre: string; texto: string; tipo: string; activo: boolean }

export async function crearElemento(usuarioId: string, datos: DatosEdicion): Promise<Resultado<ElementoBiblioteca>> {

    if (origenDeTipo(datos.tipo) === "inicio_dia") {
        // Orden: al final de las plantillas de Inicio del día del cliente.
        const { data: existentes } = await listarPlantillas(usuarioId, TIPO_INICIO_DIA);
        const orden = ((existentes || []) as PlantillaMensaje[]).reduce((max, p) => Math.max(max, p.orden ?? 0), -1) + 1;
        const { data, error } = await crearPlantilla({
            usuario_id: usuarioId,
            tipo_respuesta: TIPO_INICIO_DIA,
            nombre: datos.nombre,
            estilo: "personalizada",
            contenido: datos.texto,
            variables: valoresPorDefectoVariables(),
            habilitada: datos.activo,
            orden
        });
        return { data: data ? desdeInicioDia(data as PlantillaMensaje) as ElementoBiblioteca : null, error: fallo(error, "No se pudo crear") };
    }

    // Un mensaje nuevo ya no lleva categoría.
    const { data, error } = await crearMensaje(usuarioId, { nombre_interno: datos.nombre, texto: datos.texto, tipo: datos.tipo, categoria: null, activo: datos.activo });
    return { data: data ? desdeAutomatizacion(data as AutomationMessage) as ElementoBiblioteca : null, error: fallo(error, "No se pudo crear") };

}

// Editar NUNCA envía `categoria`: la que tuviera el mensaje se conserva.
export async function actualizarElemento(elemento: ElementoBiblioteca, datos: DatosEdicion): Promise<Resultado<ElementoBiblioteca>> {

    if (elemento.origen === "inicio_dia") {
        const { data, error } = await actualizarPlantilla(elemento.id, { nombre: datos.nombre, contenido: datos.texto, habilitada: datos.activo });
        return { data: data ? desdeInicioDia(data as PlantillaMensaje) as ElementoBiblioteca : null, error: fallo(error, "No se pudo guardar") };
    }

    const { data, error } = await actualizarMensaje(elemento.id, { nombre_interno: datos.nombre, texto: datos.texto, tipo: datos.tipo, activo: datos.activo });
    return { data: data ? desdeAutomatizacion(data as AutomationMessage) as ElementoBiblioteca : null, error: fallo(error, "No se pudo guardar") };

}

export async function alternarElemento(elemento: ElementoBiblioteca, activo: boolean): Promise<Resultado<ElementoBiblioteca>> {

    if (elemento.origen === "inicio_dia") {
        const { data, error } = await alternarHabilitada(elemento.id, activo);
        return { data: data ? desdeInicioDia(data as PlantillaMensaje) as ElementoBiblioteca : null, error: fallo(error, "No se pudo cambiar") };
    }

    const { data, error } = await alternarActivo(elemento.id, activo);
    return { data: data ? desdeAutomatizacion(data as AutomationMessage) as ElementoBiblioteca : null, error: fallo(error, "No se pudo cambiar") };

}

// Duplicar crea SIEMPRE una copia propia; en automatización conserva la
// categoría del original (sigue siendo elegible donde lo era).
export async function duplicarElemento(usuarioId: string, elemento: ElementoBiblioteca): Promise<Resultado<ElementoBiblioteca>> {

    if (elemento.origen === "inicio_dia") {
        const { data, error } = await duplicarPlantilla(elemento.fila as PlantillaMensaje);
        return { data: data ? desdeInicioDia(data as PlantillaMensaje) as ElementoBiblioteca : null, error: fallo(error, "No se pudo duplicar") };
    }

    const { data, error } = await duplicarMensaje(usuarioId, elemento.fila as AutomationMessage);
    return { data: data ? desdeAutomatizacion(data as AutomationMessage) as ElementoBiblioteca : null, error: fallo(error, "No se pudo duplicar") };

}

export async function eliminarElemento(elemento: ElementoBiblioteca): Promise<{ error: string | null }> {

    const { error } = elemento.origen === "inicio_dia" ? await eliminarPlantilla(elemento.id) : await eliminarMensaje(elemento.id);
    return { error: fallo(error, "No se pudo eliminar") };

}
