"use client";

import { useRef, useState } from "react";
import { RotateCcw, Pencil, Share2, Users, type LucideIcon } from "lucide-react";

import ConfirmDialog from "./ConfirmDialog";
import AnuncioSorteoModal from "./AnuncioSorteoModal";
import CompartirTablaModal, { nuevaSolicitud, type PanelCompartir } from "./CompartirTablaModal";
import { compartirTabla, mensajeCompartir } from "@/services/tablas/compartirTabla";

interface Props {
    precio: number;
    totalNumeros: number;
    disponibles: number;
    usuarioId: string | null;
    onReiniciar: () => Promise<void> | void;
    /** PNG (data URL) del `div` de la tabla visible. */
    capturarTabla: () => Promise<string>;
}

export default function AccionesTabla({
    precio,
    totalNumeros,
    disponibles,
    usuarioId,
    onReiniciar,
    capturarTabla
}: Props) {

    const [confirmandoReinicio, setConfirmandoReinicio] = useState(false);
    const [reiniciando, setReiniciando] = useState(false);
    const [compartiendo, setCompartiendo] = useState(false);
    const [panelCompartir, setPanelCompartir] = useState<PanelCompartir | null>(null);
    // Bloqueo síncrono: dos clics seguidos no lanzan dos envíos.
    const compartiendoRef = useRef(false);
    const [editandoAnuncio, setEditandoAnuncio] = useState(false);

    async function confirmarReinicio() {

        setReiniciando(true);

        try {

            await onReiniciar();
            setConfirmandoReinicio(false);

        } catch (e) {

            alert(e instanceof Error ? e.message : "No se pudo reiniciar la tabla.");

        } finally {

            setReiniciando(false);

        }

    }

    // Un clic: captura de la tabla visible + texto configurado a los grupos
    // GUARDADOS de esta tabla. Sin grupos guardados (o si ya no están
    // disponibles) se abre la configuración: vista previa, grupos y
    // confirmación, con esa misma captura.
    async function compartir() {

        if (!usuarioId) {
            alert("Debes iniciar sesión para compartir la tabla.");
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

            const resultado = await compartirTabla(precio, { solicitudId: nuevaSolicitud(), imagen });

            if (resultado.motivo === "sin_destinos" || resultado.motivo === "destinos_no_disponibles") {
                setPanelCompartir({ tipo: "configurar", imagen, aviso: resultado.motivo === "sin_destinos" ? "Elige los grupos donde se publicará esta tabla." : mensajeCompartir(resultado.motivo) });
                return;
            }

            setPanelCompartir({ tipo: "resultado", resultado });

        } catch {

            setPanelCompartir({ tipo: "resultado", resultado: { enviado: false, motivo: "error_interno" } });

        } finally {

            compartiendoRef.current = false;
            setCompartiendo(false);

        }

    }

    return (

        <>

            <div className="flex flex-wrap gap-2">

                <BotonIcono
                    icon={RotateCcw}
                    label="Reiniciar"
                    color="text-rose-600 hover:bg-rose-50 hover:border-rose-200"
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
                    disabled={compartiendo}
                    onClick={compartir}
                />

                <BotonIcono
                    icon={Users}
                    label="Cambiar grupos"
                    color="text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200"
                    disabled={compartiendo}
                    onClick={() => setPanelCompartir({ tipo: "configurar" })}
                />

            </div>

            <ConfirmDialog
                abierto={confirmandoReinicio}
                titulo={`¿Reiniciar la tabla $${precio.toLocaleString("es-CO")}?`}
                descripcion="Esto deja las 100 celdas de esta tabla como 'Disponible' otra vez: se borran cliente, contacto, grupo, evento y fechas de cada reserva. Solo afecta tus propias filas."
                detalle={`Ahora mismo hay ${totalNumeros - disponibles} de ${totalNumeros} números ocupados (reservados, pagados, en proceso o bloqueados). Todos volverán a estar disponibles.`}
                textoConfirmar="Sí, reiniciar"
                cargando={reiniciando}
                onConfirmar={confirmarReinicio}
                onCancelar={() => setConfirmandoReinicio(false)}
            />

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

function BotonIcono({
    icon: Icon,
    label,
    color,
    destacado = false,
    disabled = false,
    onClick
}: {
    icon: LucideIcon;
    label: string;
    color: string;
    destacado?: boolean;
    disabled?: boolean;
    onClick: () => void;
}) {

    return (

        <button
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            className={`flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-sm font-medium min-w-[44px] min-h-[44px] border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                destacado
                    ? "bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700"
                    : `bg-white border-gray-200 ${color}`
            }`}
        >
            <Icon size={16} className="shrink-0" />
            <span className="hidden sm:inline">{label}</span>
        </button>

    );

}
