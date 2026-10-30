"use client";

import { useRef, useState, type ReactNode } from "react";
import { RotateCcw, Pencil, Share2, Users, RefreshCw, type LucideIcon } from "lucide-react";

import { Spinner } from "@/components/ui/Spinner";
import { avisar } from "@/components/ui/Avisos";
import { useAccion } from "@/hooks/useAccion";

import ReinicioTablaModal from "./ReinicioTablaModal";
import AnuncioSorteoModal from "./AnuncioSorteoModal";
import CompartirTablaModal, { enviarCompartir, nuevaSolicitud, panelResultado, type PanelCompartir } from "./CompartirTablaModal";
import { mensajeCompartir } from "@/services/tablas/compartirTabla";
import type { ConfirmacionReinicio, ResultadoReinicio, RevisionReinicio } from "@/services/tablas/reiniciarTabla";

interface Props {
    precio: number;
    /** Ya no se usan aquí (el diálogo de reinicio lee el estado real). */
    totalNumeros?: number;
    disponibles?: number;
    usuarioId: string | null;
    /** Impacto del reinicio (solo lectura) para el diálogo. */
    onRevisarReinicio: () => Promise<RevisionReinicio>;
    /** Reinicio con la confirmación del diálogo (lanza si no se hizo). */
    onReiniciar: (confirmacion?: ConfirmacionReinicio) => Promise<ResultadoReinicio>;
    /** PNG (data URL) del `div` de la tabla visible. */
    capturarTabla: () => Promise<string>;
    /** Vuelve a leer la tabla del servidor (botón «Actualizar»). */
    onActualizar?: () => Promise<void>;
    /** Acciones de la vista (Personalizar, Diseños…) que van en la segunda
     *  fila, después de «Cambiar grupos». */
    segundaFila?: ReactNode;
}

export default function AccionesTabla({
    precio,
    usuarioId,
    onRevisarReinicio,
    onReiniciar,
    capturarTabla,
    onActualizar,
    segundaFila
}: Props) {

    // «Actualizar»: relectura real de la tabla (la misma que hace el tiempo
    // real), con el botón girando hasta que los datos nuevos están en pantalla.
    const actualizar = useAccion(async () => { await onActualizar?.(); }, {
        onError: (m) => avisar.error(`No se pudo actualizar la tabla: ${m}`)
    });

    const [confirmandoReinicio, setConfirmandoReinicio] = useState(false);
    const [compartiendo, setCompartiendo] = useState(false);
    const [panelCompartir, setPanelCompartir] = useState<PanelCompartir | null>(null);
    // Bloqueo síncrono: dos clics seguidos no lanzan dos envíos.
    const compartiendoRef = useRef(false);
    const [editandoAnuncio, setEditandoAnuncio] = useState(false);

    // Un clic: captura de la tabla visible + texto configurado a los grupos
    // GUARDADOS de esta tabla. Sin grupos guardados (o si ya no están
    // disponibles) se abre la configuración: vista previa, grupos y
    // confirmación, con esa misma captura.
    async function compartir() {

        if (!usuarioId) {
            avisar.error("Debes iniciar sesión para compartir la tabla.");
            return;
        }

        if (compartiendoRef.current) return;
        compartiendoRef.current = true;
        setCompartiendo(true);

        try {

            let imagen: string;

            try {
                imagen = await capturarTabla();
            } catch (e) {
                setPanelCompartir({ tipo: "resultado", resultado: { enviado: false, motivo: "error_imagen", aviso: e instanceof Error ? e.message : undefined } });
                return;
            }

            setPanelCompartir({ tipo: "enviando" });

            const envio = { solicitudId: nuevaSolicitud(), imagen };
            const resultado = await enviarCompartir(precio, envio);

            if (resultado.motivo === "sin_destinos" || resultado.motivo === "destinos_no_disponibles") {
                setPanelCompartir({ tipo: "configurar", imagen, aviso: resultado.motivo === "sin_destinos" ? "Elige los grupos donde se publicará esta tabla." : mensajeCompartir(resultado.motivo) });
                return;
            }

            setPanelCompartir(panelResultado(resultado, envio));

        } catch {

            setPanelCompartir({ tipo: "resultado", resultado: { enviado: false, motivo: "error_interno" } });

        } finally {

            compartiendoRef.current = false;
            setCompartiendo(false);

        }

    }

    return (

        <>

            {/* Dos filas centradas: Reiniciar · Editar · Compartir /
                Cambiar grupos · Personalizar · Diseños. */}
            <div className="flex flex-col items-center gap-2 min-w-0">

                <div className="flex flex-wrap justify-center gap-2 min-w-0">

                    <BotonIcono
                        icon={RotateCcw}
                        label="Reiniciar"
                        color="text-rose-600 hover:bg-rose-50 hover:border-rose-200"
                        mostrarTexto
                        onClick={() => setConfirmandoReinicio(true)}
                    />

                    <BotonIcono
                        icon={Pencil}
                        label="Editar"
                        color="text-gray-600 hover:bg-gray-50 hover:border-gray-300"
                        onClick={() => setEditandoAnuncio(true)}
                    />

                    <BotonIcono
                        icon={Share2}
                        label={compartiendo ? "Compartiendo…" : "Compartir"}
                        color="text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200"
                        destacado
                        cargando={compartiendo}
                        onClick={compartir}
                    />

                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 min-w-0">

                    <BotonIcono
                        icon={Users}
                        label="Cambiar grupos"
                        color="text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200"
                        disabled={compartiendo}
                        onClick={() => setPanelCompartir({ tipo: "configurar" })}
                    />

                    {segundaFila}

                    {onActualizar && (
                        <BotonIcono
                            icon={RefreshCw}
                            label={actualizar.procesando ? "Actualizando…" : "Actualizar"}
                            color="text-gray-600 hover:bg-gray-50 hover:border-gray-300"
                            cargando={actualizar.procesando}
                            onClick={() => { void actualizar.ejecutar(); }}
                        />
                    )}

                </div>

            </div>

            {/* Revisión del impacto y confirmación explícita (ver ReinicioTablaModal). */}
            {confirmandoReinicio && (
                <ReinicioTablaModal
                    precio={precio}
                    onRevisar={onRevisarReinicio}
                    onReiniciar={onReiniciar}
                    onClose={() => setConfirmandoReinicio(false)}
                />
            )}

            {/* «Editar» prepara el anuncio del sorteo en un modal de esta
                misma pantalla (sin navegar). Se monta por apertura. */}
            {panelCompartir && (
                <CompartirTablaModal
                    precio={precio}
                    capturarTabla={capturarTabla}
                    panel={panelCompartir}
                    onCambiar={setPanelCompartir}
                    onClose={() => setPanelCompartir(null)}
                />
            )}

            {editandoAnuncio && (
                <AnuncioSorteoModal precio={precio} onClose={() => setEditandoAnuncio(false)} />
            )}

        </>

    );

}

// Botón con icono y texto de la barra de Tablas. No es IconButton (solo
// icono, 30/36 px): este lleva texto visible, 44 px táctiles y colores por
// acción. Comparte con Button/IconButton el estado de carga: el mismo
// Spinner en lugar del icono (también en móvil, donde el texto se oculta),
// aria-busy y sin clics mientras carga.
export function BotonIcono({
    icon: Icon,
    label,
    color,
    destacado = false,
    disabled = false,
    cargando = false,
    mostrarTexto = false,
    onClick
}: {
    icon: LucideIcon;
    label: string;
    color: string;
    destacado?: boolean;
    disabled?: boolean;
    /** Operación en curso: spinner en lugar del icono y deshabilitado. */
    cargando?: boolean;
    /** El texto se ve también en pantallas pequeñas. */
    mostrarTexto?: boolean;
    onClick: () => void;
}) {

    return (

        <button
            type="button"
            onClick={onClick}
            disabled={disabled || cargando}
            aria-busy={cargando || undefined}
            aria-label={label}
            title={label}
            className={`flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-sm font-medium min-w-[44px] min-h-[44px] border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                destacado
                    ? "bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700"
                    : `bg-white border-gray-200 ${color}`
            }`}
        >
            {cargando ? <Spinner size={16} /> : <Icon size={16} className="shrink-0" />}
            <span className={mostrarTexto ? undefined : "hidden sm:inline"}>{label}</span>
        </button>

    );

}
