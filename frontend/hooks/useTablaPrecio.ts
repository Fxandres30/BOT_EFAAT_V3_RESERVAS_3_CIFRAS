"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import type { TablaConfig } from "@/lib/tablasConfig";
import { obtenerTablaConfigCliente } from "@/services/tablas/tablasCliente";
import { getUser } from "@/services/auth/getUser";
import { obtenerTabla, obtenerNumerosTabla } from "@/services/tablas/obtenerTabla";
import { obtenerEventoActivo } from "@/services/tablas/obtenerEventoActivo";
import { obtenerActividad, obtenerActividadDesde } from "@/services/tablas/obtenerActividad";
import { obtenerEventosHistorial, LIMITE_HISTORIAL, type EventosHistorial } from "@/services/tablas/obtenerHistorial";
import { reiniciarTabla, revisarReinicio as revisarReinicioTabla, type ConfirmacionReinicio, type ResultadoReinicio, type RevisionReinicio } from "@/services/tablas/reiniciarTabla";
import { prepararCuadricula, diagnosticar, type DiagnosticoCuadricula } from "@/services/tablas/prepararCuadricula";
// Reservar, registrar el pago, liberar y desbloquear pasan por el backend
// (mismas reglas que el bot + auditoría): el navegador ya no escribe en la
// tabla de números.
import {
    reservarNumeroManual,
    pagarNumeroManual,
    liberarNumeroManual,
    operarLote,
    type DatosReserva,
    type DatosPago,
    type DatosLiberar,
    type Resultado
} from "@/services/tablas/reservaManual";
import { crearRecargaAgrupada } from "@/services/tablas/recargaAgrupada";
import { crearSincronizacion, type EstadoSincronizacion } from "@/services/tablas/sincronizacionTabla";
import {
    crearVersiones,
    decidirAvisoNumero,
    desdeVentana,
    esDeOtraTabla,
    fusionarNumeros,
    fusionarPorId,
    reemplazarNumeros,
    type AvisoRealtime
} from "@/services/tablas/cambiosTabla";
import { procesarOperacion, type DatosOperacion, type NumeroSeleccionable, type OperacionLote, type ResultadoOperacion } from "@/services/tablas/pagoLote";
// Motor de rifas independientes: la misma pantalla sobre una rifa (tabla_id).
import {
    configDeRifa,
    filaPanel,
    leerNumerosRifa,
    obtenerActividadRifa,
    obtenerEventoActivoRifa,
    obtenerHistorialRifa,
    obtenerRifaPanel,
    reiniciarRifa,
    revisarReinicioRifa,
    type RifaPanel
} from "@/services/tablas/fuenteRifa";
import { apiRifas, mensajeMotivo } from "@/services/rifas/apiRifas";
import { guardar as guardarCache, leer as leerCache } from "@/lib/cache/almacen";

import { derivarPaquetes } from "@/components/tablas/derivarPaquetes";
import { estadoEfectivo } from "@/components/tablas/estadoVisual";
import { construirHistorial, type ContactoIdentidad, type FilaArchivo, type FilaAuditoria } from "@/components/tablas/historialDatos";
import { obtenerContactos } from "@/services/contactos/obtenerContactos";
import { useAccionesPorClave } from "@/hooks/useAccion";
import type { NumeroReserva, EventoActivo, ActividadReserva } from "@/components/tablas/types";

// «Actividad reciente» muestra las 15 primeras; el historial, hasta LIMITE_HISTORIAL.
const RECIENTES = 15;
// Al ponerse al día por fecha se repite este margen (dedupe por id): una
// transacción larga puede registrar una fecha anterior a otra ya leída.
const MARGEN_VENTANA_MS = 2 * 60_000;
// Tras un cambio (propio o ajeno) la auditoría se pide pasado este tiempo de
// calma: el backend la escribe justo después del número.
const ESPERA_AUDITORIA_MS = 1500;

// Sin sesión todavía: nada que operar.
const sinSesion: Resultado = { ok: false, motivo: "sin_sesion", mensaje: "Debes iniciar sesión." };
const enCurso: Resultado = { ok: false, motivo: "en_curso", mensaje: "Ya se está procesando este número. Espera a que termine." };

const fechaActividad = (a: ActividadReserva) => a.creado_en;
const fechaAuditoria = (a: FilaAuditoria) => a.creado_en;
const fechaArchivo = (a: FilaArchivo) => a.archivado_en;

// ---------------------------------------------------------------------------
// Lo último que se vio de una tabla (caché en memoria del panel, que se vacía
// al cambiar de usuario o cerrar sesión: lib/cache/sesion.ts). Al volver a la
// tabla desde otra sección se pinta esto al instante (sin pantalla de carga
// ni lectura completa extra) y la validación con el servidor, tras conectar
// el tiempo real, lo pone al día. No es la autoridad: el servidor sí.
// ---------------------------------------------------------------------------

export interface InstantaneaTabla {
    usuarioId: string;
    config: TablaConfig;
    rifa: RifaPanel | null;
    numeros: NumeroReserva[];
    evento: EventoActivo | null;
    actividad: ActividadReserva[];
}

export const claveVistaTabla = (tablaId: string | null, precio: number) => `tablaVista|${tablaId ?? `precio:${precio}`}`;

export function leerInstantaneaTabla(clave: string): InstantaneaTabla | null {
    const d = leerCache<InstantaneaTabla>(clave);
    return d && d.usuarioId && d.config && d.numeros.length > 0 ? d : null;
}

// Único hook fuente-de-verdad de la pantalla /tablas/:precio. Todo lo que
// se ve en pantalla (grid, stats, filtros, reservas recientes, grupos,
// actividad) sale de aquí — ningún componente vuelve a consultar Supabase
// por su cuenta ni mantiene su propia copia del estado.
//
// Cómo se mantiene al día (sin recargar la tabla entera):
//   - un aviso de Realtime de un número actualiza ESE número con la fila
//     recibida (services/tablas/cambiosTabla.ts: guarda de orden, ecos y
//     repetidos sin efecto); si llega incompleto, se relee ese número;
//   - tras una operación propia se releen solo los números operados;
//   - los avisos de otra tabla física del cliente se descartan;
//   - actividad y auditoría se ponen al día con lo nuevo, no con 1000 filas;
//   - al perder la conexión en tiempo real (canal caído, sin red) y
//     recuperarla, se vuelve a validar todo (services/tablas/sincronizacionTabla.ts).
// El servidor sigue siendo la autoridad: cada operación se valida allí.
// tablaId (motor de rifas independientes): la pantalla es la de siempre, pero
// sus números, reservas, pagos, actividad e historial son los de ESA rifa.
export function useTablaPrecio(precioPedido: number, tablaId?: string | null) {

    // Lo último que se vio de ESTA tabla (memoria de la pestaña, del usuario
    // de la sesión): al volver de otra sección se pinta al instante, sin
    // pantalla de carga, y se valida con el servidor en segundo plano.
    const claveTabla = claveVistaTabla(tablaId ?? null, precioPedido);
    const [inicial] = useState(() => leerInstantaneaTabla(claveTabla));

    // Tabla física de este precio SEGÚN EL CLIENTE de la sesión
    // (tablas_cliente); se resuelve al conocer el usuario.
    const [config, setConfig] = useState<TablaConfig | null>(inicial?.config ?? null);
    // La rifa abierta (solo con tablaId). Su precio es el de la tabla.
    const [rifa, setRifa] = useState<RifaPanel | null>(inicial?.rifa ?? null);
    const precio = rifa ? rifa.precio : precioPedido;

    const [usuarioId, setUsuarioId] = useState<string | null>(inicial?.usuarioId ?? null);

    const [numeros, setNumeros] = useState<NumeroReserva[]>(inicial?.numeros ?? []);
    const [eventoActivo, setEventoActivo] = useState<EventoActivo | null>(inicial?.evento ?? null);
    const [actividad, setActividad] = useState<ActividadReserva[]>(inicial?.actividad ?? []);
    const [eventosHistorial, setEventosHistorial] = useState<EventosHistorial>({ auditoria: [], auditoriaDisponible: false, archivo: [] });
    // Auditoría, archivo, actividad completa y directorio: se piden al abrir
    // «Historial de números» (cargarHistorial), no al entrar a la cuadrícula.
    const [historialCargado, setHistorialCargado] = useState(false);
    // Se perdió la conexión en tiempo real (o la red) y todavía no se ha
    // vuelto a validar: lo que se ve puede no estar al día.
    const [desactualizada, setDesactualizada] = useState(false);

    const [loading, setLoading] = useState(!inicial);
    const [error, setError] = useState<string | null>(null);
    // Operaciones en curso, una clave por número ("lote" = operación por
    // lote, "*" = reinicio): cada número se procesa por su cuenta, así
    // operar el 05 no bloquea ni hace girar el 07. Una segunda operación
    // sobre la MISMA clave (doble clic) no se lanza.
    const acciones = useAccionesPorClave();
    const accionando = acciones.activas;

    // Sin filas visibles: qué dice el backend (cuadrícula creada, migración
    // pendiente, RLS que oculta las filas...). null mientras haya filas.
    const [diagnostico, setDiagnostico] = useState<DiagnosticoCuadricula | null>(null);

    // Directorio de contactos del cliente (backend GET /contactos, filtrado
    // por el token): solo aporta el nombre y teléfono ACTUALES de las
    // identidades que ya aparecen en esta tabla, para la búsqueda del
    // historial. Se pide con el historial; si falla, la búsqueda sigue con
    // los datos de la tabla.
    const [contactos, setContactos] = useState<ContactoIdentidad[]>([]);

    // Puesta al día de la tabla abierta (una por usuario + tabla física).
    const control = useRef<ControlTabla | null>(null);
    const historialPedido = useRef(false);
    // Lo que necesita abrirTabla, sin que su identidad reabra la tabla.
    // (Se actualizan en un efecto declarado ANTES del que abre la tabla: en
    // el mismo render se ejecuta primero.)
    const rifaApertura = useRef(rifa);
    const precioApertura = useRef(precio);
    useEffect(() => {
        rifaApertura.current = rifa;
        precioApertura.current = precio;
    });
    // Dueño de lo que se pintó al montar (instantánea en memoria).
    const usuarioInicial = useRef(inicial?.usuarioId ?? null);

    // Otra tabla en la MISMA pantalla (cambió la dirección): nada de la
    // anterior se mezcla; se pinta lo guardado de la nueva o se carga.
    const tablaVista = useRef(claveTabla);
    useEffect(() => {
        if (tablaVista.current === claveTabla) return;
        tablaVista.current = claveTabla;
        const guardada = leerInstantaneaTabla(claveTabla);
        setRifa(guardada?.rifa ?? null);
        setConfig(guardada?.config ?? null);
        setNumeros(guardada?.numeros ?? []);
        setEventoActivo(guardada?.evento ?? null);
        setActividad(guardada?.actividad ?? []);
        setEventosHistorial({ auditoria: [], auditoriaDisponible: false, archivo: [] });
        setContactos([]);
        setHistorialCargado(false);
        setDesactualizada(false);
        setError(null);
        setLoading(!guardada);
    }, [claveTabla]);

    useEffect(() => {

        let vivo = true;

        async function iniciar() {

            const { data } = await getUser();

            if (!vivo) return;

            if (!data.user) {
                setError("Debes iniciar sesión para ver esta tabla.");
                setLoading(false);
                return;
            }

            // Lo guardado era de otra cuenta: no se muestra nada de ello.
            if (usuarioInicial.current && usuarioInicial.current !== data.user.id) {
                usuarioInicial.current = null;
                setNumeros([]);
                setEventoActivo(null);
                setActividad([]);
                setRifa(null);
                setConfig(null);
                setLoading(true);
            }

            if (tablaId) {
                let r: RifaPanel | null = null;
                try {
                    r = await obtenerRifaPanel(tablaId, data.user.id);
                } catch {
                    r = null;
                }
                if (!vivo) return;
                if (!r) {
                    setError("No existe esta tabla.");
                    setLoading(false);
                    return;
                }
                // Solo si cambió de verdad: la misma rifa no vuelve a abrir
                // ni repintar la tabla.
                setRifa(prev => (prev && JSON.stringify(prev) === JSON.stringify(r) ? prev : r));
                setConfig(prev => {
                    const nueva = configDeRifa(r);
                    return prev && JSON.stringify(prev) === JSON.stringify(nueva) ? prev : nueva;
                });
                setUsuarioId(data.user.id);
                return;
            }

            const precio = precioPedido;
            const cfg = await obtenerTablaConfigCliente(precio, data.user.id);

            if (!vivo) return;

            if (!cfg) {
                setError("No existe una tabla configurada para este precio.");
                setLoading(false);
            }

            setConfig(prev => (prev && cfg && JSON.stringify(prev) === JSON.stringify(cfg) ? prev : cfg));
            setUsuarioId(data.user.id);

        }

        iniciar();

        return () => { vivo = false; };

    }, [precioPedido, tablaId]);

    useEffect(() => {

        if (!usuarioId || !config) return;

        // Con tablaId, hasta tener ESA rifa (no la de la dirección anterior) no se abre nada.
        if (tablaId && rifa?.id !== tablaId) return;

        // Lo ya visto de esta misma tabla y usuario: se parte de ahí (sin
        // pantalla de carga) y solo se pinta lo que cambie.
        const guardada = leerInstantaneaTabla(claveTabla);
        const previa = guardada && guardada.usuarioId === usuarioId && guardada.config.tabla === config.tabla && (guardada.rifa?.id ?? null) === (tablaId ?? null) ? guardada : null;

        const c = abrirTabla({
            precio: precioApertura.current,
            usuarioId,
            config,
            historialPedido: () => historialPedido.current,
            vista: { setNumeros, setEventoActivo, setActividad, setEventosHistorial, setContactos, setHistorialCargado, setDiagnostico, setError, setLoading, setDesactualizada },
            fuente: rifaApertura.current ? fuenteDeRifa(rifaApertura.current) : undefined,
            inicial: previa ? { numeros: previa.numeros, evento: previa.evento, actividad: previa.actividad } : undefined
        });

        control.current = c;

        // Solo se cierran canales y lecturas: lo que se ve se conserva hasta
        // que llegue lo nuevo (otra tabla u otro usuario se limpian aparte).
        return () => {
            c.cerrar();
            if (control.current === c) control.current = null;
        };

    // Se vuelve a abrir solo si cambia la IDENTIDAD de la tabla (usuario,
    // tabla física, rifa por tabla_id, o el precio en la tabla antigua);
    // editar el valor de una rifa o releerla no repite la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [usuarioId, config?.tabla, rifa?.id, tablaId ? null : precio, tablaId]);

    // Instantánea en memoria de lo que se ve (para volver sin recargar).
    useEffect(() => {
        if (loading || !usuarioId || !config || numeros.length === 0) return;
        guardarCache<InstantaneaTabla>(claveTabla, { usuarioId, config, rifa, numeros, evento: eventoActivo, actividad });
    }, [claveTabla, loading, usuarioId, config, rifa, numeros, eventoActivo, actividad]);

    const cargarHistorial = useCallback(() => {
        historialPedido.current = true;
        control.current?.cargarHistorial();
    }, []);

    // Tabla antigua: el sorteo activo es el de este precio. Rifa: el sorteo
    // ya se leyó por su tabla_id (es el de ESTA rifa, valga lo que valga).
    const coincidePrecio = Boolean(
        eventoActivo && (rifa ? true : Number(eventoActivo.valor) === precio)
    );

    const stats = useMemo(() => {

        const efectivos = numeros.map(estadoEfectivo);

        const contar = (estado: string) => efectivos.filter(e => e === estado).length;

        const total = numeros.length;
        const disponibles = contar("libre");
        const reservados = contar("reservado");
        const pagados = contar("pagado");
        const enProceso = contar("en_proceso");
        const bloqueados = contar("bloqueado");

        const ocupacion = total > 0
            ? Math.round(((total - disponibles) / total) * 100)
            : 0;

        return { total, disponibles, reservados, pagados, enProceso, bloqueados, ocupacion };

    }, [numeros]);

    const paquetes = useMemo(() => derivarPaquetes(numeros), [numeros]);

    // Mismo límite que antes para «Actividad reciente».
    const actividadReciente = useMemo(() => actividad.slice(0, RECIENTES), [actividad]);

    const historial = useMemo(() => construirHistorial(numeros, {
        auditoria: eventosHistorial.auditoria,
        auditoriaDisponible: eventosHistorial.auditoriaDisponible,
        actividad,
        archivo: eventosHistorial.archivo,
        contactos
    }, estadoEfectivo), [numeros, actividad, eventosHistorial, contactos]);

    const recientes = useMemo(() => {

        return [...numeros]
            .filter(n => n.estado !== "libre" && n.fecha_reserva)
            .sort((a, b) => {
                const fa = `${a.fecha_reserva}T${a.hora_reserva || "00:00:00"}`;
                const fb = `${b.fecha_reserva}T${b.hora_reserva || "00:00:00"}`;
                return fb.localeCompare(fa);
            })
            .slice(0, 10);

    }, [numeros]);

    // Operación sobre una clave. El resultado del servidor se devuelve en
    // cuanto llega; la clave sigue ocupada hasta que los números operados
    // están releídos en pantalla (también tras un rechazo: el número pudo
    // cambiar entretanto), así no se vuelve a operar sobre un estado viejo.
    // "todo" (reinicio) espera la recarga completa. null = esa clave ya
    // estaba en curso.
    const { iniciar, terminar } = acciones;

    const ejecutar = useCallback(async <T,>(clave: string, afectados: string[] | "todo", accion: () => Promise<T>): Promise<T | null> => {

        if (!iniciar(clave)) return null;

        const ponerAlDia = () => {
            const c = control.current;
            if (!c) return Promise.resolve();
            return afectados === "todo" ? c.recargarTodo() : c.trasOperacion(afectados);
        };

        let resultado: T;

        try {
            resultado = await accion();
        } catch (e) {
            // Sin respuesta clara: los números se releen igualmente.
            ponerAlDia().catch(() => {}).finally(() => terminar(clave));
            throw e;
        }

        if (afectados === "todo") {
            try {
                await ponerAlDia();
                return resultado;
            } finally {
                terminar(clave);
            }
        }

        ponerAlDia().catch(() => {}).finally(() => terminar(clave));
        return resultado;

    }, [iniciar, terminar]);

    // Funciones estables: las celdas y paneles memorizados no se vuelven a
    // dibujar porque cambie su identidad.
    const recargar = useCallback(async () => {
        await control.current?.recargarTodo();
    }, []);

    const reservar = useCallback(async (numero: string, datos: DatosReserva): Promise<Resultado> => {
        if (!usuarioId) return sinSesion;
        return (await ejecutar(numero, [numero], () => reservarNumeroManual(precio, numero, datos, rifa?.id))) ?? enCurso;
    }, [usuarioId, ejecutar, precio, rifa]);

    const marcarPagado = useCallback(async (numero: string, datos?: DatosPago): Promise<Resultado> => {
        if (!usuarioId) return sinSesion;
        // Éxito en cuanto el servidor lo confirma; el número se relee detrás.
        return (await ejecutar(numero, [numero], () => pagarNumeroManual(precio, numero, datos, rifa?.id))) ?? enCurso;
    }, [usuarioId, ejecutar, precio, rifa]);

    // Varios números (o uno, desde las acciones rápidas): UNA solicitud y
    // una escritura en el servidor, y una relectura de esos números al
    // final. El resultado se muestra en cuanto el servidor lo confirma;
    // mientras se releen, "lote" sigue ocupado y la selección queda
    // bloqueada (no se selecciona sobre estados viejos).
    // null = ya había un lote en curso (no se lanza).
    const procesarLote = useCallback(async (operacion: OperacionLote, incluidos: NumeroSeleccionable[], datos: DatosOperacion, solicitudLote: string): Promise<ResultadoOperacion | null> => {
        if (!usuarioId) return null;
        return ejecutar("lote", incluidos.map(n => n.numero), () => procesarOperacion({
            operacion,
            incluidos,
            enviar: (cuerpo) => operarLote(precio, cuerpo, rifa?.id),
            datos,
            solicitudLote
        }));
    }, [usuarioId, ejecutar, precio, rifa]);

    // Libera una reserva, anula un pago o desbloquea, según el estado real.
    const liberar = useCallback(async (numero: string, datos?: DatosLiberar): Promise<Resultado> => {
        if (!usuarioId) return sinSesion;
        return (await ejecutar(numero, [numero], () => liberarNumeroManual(precio, numero, datos, rifa?.id))) ?? enCurso;
    }, [usuarioId, ejecutar, precio, rifa]);

    // Impacto del reinicio (solo lectura) para el diálogo de confirmación.
    // En una rifa, solo sus números: ninguna otra tabla se ve afectada.
    const revisarReinicio = useCallback(async (): Promise<RevisionReinicio> => {
        if (!usuarioId) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
        return rifa ? revisarReinicioRifa(rifa, usuarioId) : revisarReinicioTabla(precio, usuarioId);
    }, [usuarioId, precio, rifa]);

    // Con números ya existentes exige la confirmación del diálogo (texto,
    // anticipadas aceptadas y la huella revisada). Recarga al terminar.
    const reiniciar = useCallback(async (confirmacion?: ConfirmacionReinicio): Promise<ResultadoReinicio> => {
        if (!usuarioId) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
        const r = await ejecutar("*", "todo", () => rifa ? reiniciarRifa(rifa, usuarioId, confirmacion) : reiniciarTabla(precio, usuarioId, confirmacion));
        if (!r) throw new Error("Ya se está reiniciando esta tabla. Espera a que termine.");
        return r;
    }, [usuarioId, ejecutar, precio, rifa]);

    // Solo en el motor de rifas: cambia el VALOR de esta tabla. Es la misma
    // rifa (mismo tabla_id): sus números, reservas, pagos, historial y grupos
    // se conservan; solo cambia el precio (y se vuelve a leer).
    const editarValor = useCallback(async (nuevo: number): Promise<{ ok: true; gruposAmbiguos: number } | { ok: false; mensaje: string }> => {
        if (!rifa || !usuarioId) return { ok: false, mensaje: "Esta tabla no se puede editar." };
        const r = await apiRifas.editarPrecio(rifa.id, nuevo);
        if (!r.ok) return { ok: false, mensaje: (r as { mensaje?: string }).mensaje || mensajeMotivo(r.motivo) };
        const fresca = await obtenerRifaPanel(rifa.id, usuarioId).catch(() => null);
        // Misma rifa (mismo tabla_id): no se reabre ni se recarga la tabla.
        if (fresca) setRifa(fresca);
        return { ok: true, gruposAmbiguos: r.grupos_ambiguos ?? 0 };
    }, [rifa, usuarioId]);

    return {

        config,
        // Solo en el motor de rifas: la rifa abierta (tabla_id, nombre, precio).
        rifa,
        editarValor,
        precio,
        loading,
        error,
        diagnostico,
        usuarioId,
        numeros,
        eventoActivo,
        coincidePrecio,
        stats,
        paquetes,
        recientes,
        actividad: actividadReciente,
        historial,
        historialCargado,
        auditoriaDisponible: eventosHistorial.auditoriaDisponible,
        desactualizada,
        accionando,

        cargarHistorial,
        recargar,
        reservar,
        marcarPagado,
        procesarLote,
        liberar,
        revisarReinicio,
        reiniciar

    };

}

// ---------------------------------------------------------------------------
// Tabla abierta: lecturas, avisos de Realtime y sincronización de UN usuario
// en UNA tabla física. Se cierra al salir de la pantalla o cambiar de tabla.
// ---------------------------------------------------------------------------

interface Vista {
    setNumeros: (v: NumeroReserva[]) => void;
    setEventoActivo: (v: EventoActivo | null) => void;
    setActividad: (v: ActividadReserva[]) => void;
    setEventosHistorial: (v: EventosHistorial) => void;
    setContactos: (v: ContactoIdentidad[]) => void;
    setHistorialCargado: (v: boolean) => void;
    setDiagnostico: (v: DiagnosticoCuadricula | null) => void;
    setError: (v: string | null) => void;
    setLoading: (v: boolean) => void;
    setDesactualizada: (v: boolean) => void;
}

interface OpcionesTabla {
    precio: number;
    usuarioId: string;
    config: TablaConfig;
    historialPedido: () => boolean;
    vista: Vista;
    /** De dónde salen los datos. Sin ella: la tabla del precio (de siempre). */
    fuente?: FuenteTabla;
    /** Lo último que se vio de esta tabla: se pinta ya y se valida detrás. */
    inicial?: { numeros: NumeroReserva[]; evento: EventoActivo | null; actividad: ActividadReserva[] };
}

// Lecturas y avisos de UNA tabla. La pantalla es la misma para la tabla del
// precio (cuadrícula antigua) y para una rifa del motor independiente
// (tabla_id): solo cambia esta fuente.
export interface FuenteTabla {
    /** Para nombrar los canales de tiempo real. */
    clave: string;
    leerTodos(): Promise<NumeroReserva[]>;
    leerNumeros(numeros: string[]): Promise<NumeroReserva[]>;
    leerEvento(): Promise<EventoActivo | null>;
    leerActividad(limite: number, desde?: string): Promise<ActividadReserva[]>;
    leerHistorial(desde?: { auditoria: string | null; archivo: string | null | false }): Promise<EventosHistorial>;
    /** Solo la tabla del precio: crea la cuadrícula del cliente si no existe. */
    preparar?: () => Promise<{ nums: NumeroReserva[]; diagnostico: DiagnosticoCuadricula | null }>;
    numerosRealtime: { table: string; filter: string };
    /** Aviso de Realtime → misma forma que una fila de la cuadrícula. */
    adaptarAviso(aviso: AvisoRealtime): AvisoRealtime;
    /** Aviso de eventos o actividad de OTRA tabla (se descarta). */
    esDeOtraTabla(aviso: AvisoRealtime): boolean;
}

function fuentePrecio(precio: number, usuarioId: string, tabla: string): FuenteTabla {
    return {
        clave: tabla,
        leerTodos: () => obtenerTabla(precio, usuarioId),
        leerNumeros: (numeros) => obtenerNumerosTabla(tabla, usuarioId, numeros),
        leerEvento: () => obtenerEventoActivo(tabla, usuarioId),
        leerActividad: (limite, desde) => desde ? obtenerActividadDesde(tabla, usuarioId, desde, limite) : obtenerActividad(tabla, usuarioId, limite),
        leerHistorial: (desde) => obtenerEventosHistorial(tabla, usuarioId, desde),
        preparar: async () => {
            const r = await prepararCuadricula(precio);
            const nums = r.ok && r.estado === "completa" ? await obtenerTabla(precio, usuarioId) : [];
            const d = diagnosticar(r, nums.length);
            return { nums, diagnostico: d.tipo === "lista" ? null : d };
        },
        numerosRealtime: { table: tabla, filter: `usuario_id=eq.${usuarioId}` },
        adaptarAviso: (aviso) => aviso,
        esDeOtraTabla: (aviso) => esDeOtraTabla(aviso, tabla)
    };
}

// Rifa del motor independiente: todo por su tabla_id.
export function fuenteDeRifa(rifa: RifaPanel): FuenteTabla {
    const { id, usuario_id: usuarioId, cifras } = rifa;
    const adaptar = (f: Record<string, unknown> | undefined) => (f && f.numero !== undefined ? (filaPanel(f, cifras) as unknown as Record<string, unknown>) : f);
    return {
        clave: `rifa-${id}`,
        leerTodos: () => leerNumerosRifa(id, usuarioId, cifras),
        leerNumeros: (numeros) => leerNumerosRifa(id, usuarioId, cifras, numeros),
        leerEvento: () => obtenerEventoActivoRifa(id, usuarioId),
        leerActividad: (limite, desde) => obtenerActividadRifa(id, usuarioId, limite, desde),
        leerHistorial: (desde) => obtenerHistorialRifa(id, usuarioId, cifras, desde),
        numerosRealtime: { table: "numeros_rifa", filter: `tabla_id=eq.${id}` },
        adaptarAviso: (aviso) => ({ ...aviso, new: adaptar(aviso.new as Record<string, unknown> | undefined), old: adaptar(aviso.old as Record<string, unknown> | undefined) }) as AvisoRealtime,
        esDeOtraTabla: (aviso) => {
            const fila = (aviso.new ?? aviso.old) as { tabla_id?: string | null } | undefined;
            return !fila || fila.tabla_id !== id;
        }
    };
}

type ControlTabla = ReturnType<typeof abrirTabla>;

// Exportada para las pruebas (tests/tablas/tiempoRealTabla.test.mjs).
export function abrirTabla({ precio, usuarioId, config, historialPedido, vista, fuente: fuenteDada, inicial }: OpcionesTabla) {

    const { tabla } = config;
    const fuente = fuenteDada ?? fuentePrecio(precio, usuarioId, tabla);
    let cerrada = false;

    // Copia de lo que se ve: las fusiones parten de aquí y solo se avisa a
    // React si la lista cambió de verdad.
    const datos = {
        numeros: (inicial?.numeros ?? []) as NumeroReserva[],
        evento: (inicial?.evento ?? null) as EventoActivo | null,
        actividad: (inicial?.actividad ?? []) as ActividadReserva[],
        historial: { auditoria: [], auditoriaDisponible: false, archivo: [] } as EventosHistorial
    };

    const versiones = crearVersiones();
    // Turno de la última lectura del evento activo aplicada.
    let turnoEvento = 0;
    let historial: "no" | "cargando" | "listo" = "no";
    let preparado = false;
    let primeraCarga = true;

    function ponerNumeros(lista: NumeroReserva[]) {
        if (cerrada || lista === datos.numeros) return;
        datos.numeros = lista;
        vista.setNumeros(lista);
    }

    function ponerActividad(lista: ActividadReserva[]) {
        if (cerrada || lista === datos.actividad) return;
        datos.actividad = lista;
        vista.setActividad(lista);
    }

    function ponerHistorial(h: EventosHistorial) {
        if (cerrada) return;
        const actual = datos.historial;
        if (h.auditoria === actual.auditoria && h.archivo === actual.archivo && h.auditoriaDisponible === actual.auditoriaDisponible) return;
        datos.historial = h;
        vista.setEventosHistorial(h);
    }

    // ---- lecturas -----------------------------------------------------------

    // Actividad: la primera vez las últimas (15, o las del historial si ya
    // está abierto); después, solo lo nuevo desde la más reciente.
    function leerActividad(): Promise<ActividadReserva[]> {
        const desde = desdeVentana(datos.actividad, fechaActividad, MARGEN_VENTANA_MS);
        if (!desde) return fuente.leerActividad(historial === "listo" ? LIMITE_HISTORIAL : RECIENTES);
        return fuente.leerActividad(LIMITE_HISTORIAL, desde);
    }

    // Cuadrícula + evento activo + actividad nueva. Es la validación tras
    // conectar o reconectar: cuenta como lectura completa de la cuadrícula.
    async function leerBase(): Promise<void> {

        const inicio = versiones.iniciarLectura();

        const [leidos, evt, act] = await Promise.all([
            fuente.leerTodos(),
            fuente.leerEvento(),
            leerActividad()
        ]);

        if (cerrada) return;

        let nums = leidos;

        // Ninguna fila visible no significa "tabla vacía": puede que el
        // cliente aún no tenga cuadrícula (se crea aquí si la base lo
        // permite) o que la base la tenga y no deje leerla.
        if (nums.length === 0 && !preparado && fuente.preparar) {

            preparado = true;

            const r = await fuente.preparar();
            nums = r.nums;

            if (cerrada) return;

            vista.setDiagnostico(r.diagnostico);

        } else if (nums.length > 0) {

            vista.setDiagnostico(null);

        }

        ponerNumeros(reemplazarNumeros(datos.numeros, nums, n => !versiones.lecturaVigente(n, inicio)));
        nums.forEach(n => versiones.aplicarLectura(n.numero, inicio));

        if (inicio > turnoEvento) {
            turnoEvento = inicio;
            if (datos.evento !== evt && JSON.stringify(datos.evento) !== JSON.stringify(evt)) {
                datos.evento = evt;
                vista.setEventoActivo(evt);
            }
        }

        ponerActividad(fusionarPorId(datos.actividad, act, fechaActividad, LIMITE_HISTORIAL));
        vista.setError(null);

    }

    // Auditoría nueva (con el historial abierto). El archivo solo cambia al
    // reiniciar: se mira únicamente al validar tras conectar.
    async function leerHistorialNuevo(conArchivo = false): Promise<void> {

        if (historial !== "listo") return;

        const h = await fuente.leerHistorial({
            auditoria: desdeVentana(datos.historial.auditoria, fechaAuditoria, MARGEN_VENTANA_MS),
            archivo: conArchivo ? desdeVentana(datos.historial.archivo, fechaArchivo, MARGEN_VENTANA_MS) : false
        });

        if (cerrada || historial !== "listo") return;

        const actual = datos.historial;
        ponerHistorial({
            auditoria: fusionarPorId(actual.auditoria, h.auditoria, fechaAuditoria, LIMITE_HISTORIAL),
            auditoriaDisponible: h.auditoriaDisponible || actual.auditoriaDisponible,
            archivo: fusionarPorId(actual.archivo, h.archivo, fechaArchivo, LIMITE_HISTORIAL)
        });

    }

    // Primera vez que se abre «Historial de números» (o recarga forzada):
    // las últimas LIMITE_HISTORIAL de cada fuente y el directorio.
    async function leerHistorialCompleto(): Promise<void> {

        const [act, h] = await Promise.all([
            fuente.leerActividad(LIMITE_HISTORIAL),
            fuente.leerHistorial()
        ]);

        if (cerrada) return;

        ponerActividad(fusionarPorId(datos.actividad, act, fechaActividad, LIMITE_HISTORIAL));
        // Lo que llegó por aviso mientras se leía se conserva.
        ponerHistorial({
            auditoria: fusionarPorId(h.auditoria, datos.historial.auditoria, fechaAuditoria, LIMITE_HISTORIAL),
            auditoriaDisponible: h.auditoriaDisponible,
            archivo: h.archivo
        });

    }

    // Tras conectar: espera a la carga inicial (así solo pide lo nuevo) y
    // lee de nuevo; empieza después de la suscripción, que es lo que
    // garantiza no perder un cambio entre la lectura y los avisos.
    async function validar(): Promise<void> {
        await cargaInicial.catch(() => {});
        await Promise.all([leerBase(), leerHistorialNuevo(true)]);
    }

    // ---- relecturas selectivas -----------------------------------------------

    // Números a releer, agrupados: varios avisos incompletos o una operación
    // propia hacen UNA consulta .in(numero).
    let pendientes = new Set<string>();
    let esperando: Promise<void> | null = null;

    function releer(lista: string[]): Promise<void> {

        lista.forEach(n => pendientes.add(n));
        if (esperando) return esperando;

        esperando = Promise.resolve().then(async () => {

            const numerosLeer = [...pendientes];
            pendientes = new Set();
            esperando = null;

            const inicio = versiones.iniciarLectura();
            const filas = await fuente.leerNumeros(numerosLeer);

            if (cerrada) return;

            const vigentes = filas.filter(f => versiones.lecturaVigente(f.numero, inicio));
            vigentes.forEach(f => versiones.aplicarLectura(f.numero, inicio));
            ponerNumeros(fusionarNumeros(datos.numeros, vigentes));

        });

        return esperando;

    }

    const auditoria = crearRecargaAgrupada(() => leerHistorialNuevo(), ESPERA_AUDITORIA_MS);
    const eventoActivo = crearRecargaAgrupada(async () => {
        const inicio = versiones.iniciarLectura();
        const evt = await fuente.leerEvento();
        if (cerrada || inicio <= turnoEvento) return;
        turnoEvento = inicio;
        if (JSON.stringify(datos.evento) !== JSON.stringify(evt)) {
            datos.evento = evt;
            vista.setEventoActivo(evt);
        }
    });

    // ---- avisos de Realtime --------------------------------------------------

    function alCambiarNumero(avisoRecibido: AvisoRealtime) {

        if (cerrada) return;

        const aviso = fuente.adaptarAviso(avisoRecibido);

        const actual = aviso.new?.numero !== undefined ? datos.numeros.find(n => n.numero === String(aviso.new?.numero)) : undefined;
        const d = decidirAvisoNumero(aviso, usuarioId, actual, id => datos.numeros.some(n => String(n.id) === String(id)));

        if (d.tipo === "ignorar") return;
        if (d.tipo === "recargar") { sync.senal(); return; }

        if (d.tipo === "releer") {
            // Uno más viejo que el último aplicado no aporta nada: ni se relee.
            if (versiones.esViejo(d.numero, aviso.commit_timestamp)) return;
            releer([d.numero]).catch(() => sync.validarAhora());
        } else if (versiones.aceptarEvento(d.numero, aviso.commit_timestamp)) {
            ponerNumeros(fusionarNumeros(datos.numeros, [d.fila]));
        }

        auditoria.senal();

    }

    function alCambiarEvento(aviso: AvisoRealtime) {
        if (cerrada || fuente.esDeOtraTabla(aviso)) return;
        eventoActivo.senal();
    }

    function alRegistrarActividad(aviso: AvisoRealtime) {
        if (cerrada || fuente.esDeOtraTabla(aviso)) return;
        const fila = aviso.new as unknown as ActividadReserva | undefined;
        if (!fila?.id || fila.usuario_id !== usuarioId) return;
        ponerActividad(fusionarPorId(datos.actividad, [fila], fechaActividad, LIMITE_HISTORIAL));
        auditoria.senal();
    }

    // ---- sincronización --------------------------------------------------------

    let perdida = false;
    const nombres = [`tabla-${fuente.clave}-${usuarioId}`, `eventos-${fuente.clave}-${usuarioId}`, `actividad-${fuente.clave}-${usuarioId}`];

    const sync = crearSincronizacion({
        canales: nombres,
        leer: validar,
        alCambiar: (e: EstadoSincronizacion) => {
            // Tras una pérdida sigue «desactualizada» mientras se revalida.
            if (e === "perdida") perdida = true;
            if (e === "sincronizada") perdida = false;
            if (!cerrada) vista.setDesactualizada(perdida);
        },
        enLinea: typeof navigator === "undefined" ? true : navigator.onLine
    });

    const canales = [

        supabase
            .channel(nombres[0])
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: fuente.numerosRealtime.table, filter: fuente.numerosRealtime.filter },
                alCambiarNumero
            )
            .subscribe((estado) => sync.canal(nombres[0], estado)),

        supabase
            .channel(nombres[1])
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "eventos_bot", filter: `usuario_id=eq.${usuarioId}` },
                alCambiarEvento
            )
            .subscribe((estado) => sync.canal(nombres[1], estado)),

        supabase
            .channel(nombres[2])
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "reservas_actividad", filter: `usuario_id=eq.${usuarioId}` },
                alRegistrarActividad
            )
            .subscribe((estado) => sync.canal(nombres[2], estado))

    ];

    const enLinea = () => sync.red(true);
    const sinRed = () => sync.red(false);
    window.addEventListener("online", enLinea);
    window.addEventListener("offline", sinRed);

    // ---- carga inicial ---------------------------------------------------------

    // La cuadrícula primero; el historial (si su sección está abierta) detrás.
    // Con lo ya visto en pantalla no se lee dos veces: la única lectura
    // completa es la validación tras conectar el tiempo real (o, sin él, a
    // los pocos segundos), que lo pone al día. Mientras tanto la tabla figura
    // «validando» y no se opera sobre ella.
    const cargaInicial = inicial && inicial.numeros.length > 0 ? Promise.resolve() : leerBase();
    cargaInicial
        .then(() => {
            primeraCarga = false;
            if (historialPedido()) cargarHistorial();
        })
        .catch((e) => {
            primeraCarga = false;
            if (!cerrada) vista.setError(e instanceof Error ? e.message : "No se pudo cargar la tabla.");
        })
        .finally(() => {
            if (!cerrada) vista.setLoading(false);
        });

    function cargarHistorial() {

        if (cerrada || historial !== "no" || primeraCarga) return;

        historial = "cargando";

        leerHistorialCompleto()
            .then(() => {
                if (cerrada) return;
                historial = "listo";
                vista.setHistorialCargado(true);
            })
            .catch(() => {
                // Se podrá reintentar al volver a abrir la sección.
                if (!cerrada) historial = "no";
            });

        obtenerContactos(usuarioId)
            .then(r => {
                if (!cerrada) vista.setContactos(r.contactos.map(c => ({ id: c.id, nombre: c.nombre, telefono: c.telefono })));
            })
            .catch(() => {
                console.warn("[historial] sin directorio de contactos: se busca solo con los datos de la tabla.");
            });

    }

    return {

        cargarHistorial,

        // Tras una operación propia: solo los números operados (y la
        // auditoría nueva, que el servidor ya escribió al responder).
        async trasOperacion(afectados: string[]) {
            try {
                await Promise.all([releer(afectados), leerHistorialNuevo()]);
            } catch (e) {
                sync.validarAhora();
                throw e;
            }
        },

        // «Actualizar» y reinicio: todo de nuevo.
        async recargarTodo() {
            await leerBase();
            if (historial === "listo") await leerHistorialCompleto();
        },

        cerrar() {
            cerrada = true;
            sync.cerrar();
            auditoria.cancelar();
            eventoActivo.cancelar();
            window.removeEventListener("online", enLinea);
            window.removeEventListener("offline", sinRed);
            canales.forEach(canal => supabase.removeChannel(canal));
        }

    };

}
