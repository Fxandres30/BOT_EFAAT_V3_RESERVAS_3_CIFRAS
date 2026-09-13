"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RotateCcw, Pencil, Share2, Shuffle, type LucideIcon } from "lucide-react";

import ConfirmDialog from "./ConfirmDialog";
import { compartirTabla } from "@/services/tablas/compartirTabla";

interface Props {
    precio: number;
    totalNumeros: number;
    disponibles: number;
    usuarioId: string | null;
    onReiniciar: () => Promise<void> | void;
}

export default function AccionesTabla({
    precio,
    totalNumeros,
    disponibles,
    usuarioId,
    onReiniciar
}: Props) {

    const router = useRouter();

    const [confirmandoReinicio, setConfirmandoReinicio] = useState(false);
    const [reiniciando, setReiniciando] = useState(false);
    const [compartiendo, setCompartiendo] = useState(false);

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

    function editar() {
        router.push(`/eventos?precio=${precio}`);
    }

    async function compartir() {

        if (!usuarioId) {
            alert("Debes iniciar sesión para compartir la tabla.");
            return;
        }

        setCompartiendo(true);

        try {

            const resultado = await compartirTabla(precio, usuarioId);

            if (!resultado.enviado) {

                const mensajes: Record<string, string> = {
                    sin_evento_activo: "No hay ningún sorteo activo en esta tabla para compartir.",
                    tabla_no_configurada: "Esta tabla no está configurada.",
                    error_envio: "No se pudo enviar la imagen por WhatsApp."
                };

                alert(mensajes[resultado.motivo || ""] || "No se pudo compartir la tabla.");
                return;

            }

            alert("Tabla compartida en el grupo de WhatsApp.");

        } catch {

            alert("No se pudo compartir la tabla.");

        } finally {

            setCompartiendo(false);

        }

    }

    function aleatorio() {

        const tarjetas = document.querySelectorAll("[data-estado='libre']");

        if (!tarjetas.length) {
            alert("No hay números disponibles.");
            return;
        }

        const random = tarjetas[Math.floor(Math.random() * tarjetas.length)] as HTMLElement;

        random.scrollIntoView({ behavior: "smooth", block: "center" });
        random.click();

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
                    onClick={editar}
                />

                <BotonIcono
                    icon={Shuffle}
                    label="Aleatorio"
                    color="text-violet-600 hover:bg-violet-50 hover:border-violet-200"
                    onClick={aleatorio}
                />

                <BotonIcono
                    icon={Share2}
                    label={compartiendo ? "Compartiendo…" : "Compartir"}
                    color="text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200"
                    destacado
                    disabled={compartiendo}
                    onClick={compartir}
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
