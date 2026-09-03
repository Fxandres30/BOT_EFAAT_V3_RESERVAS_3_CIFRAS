"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RotateCcw, Pencil, Share2, Shuffle, type LucideIcon } from "lucide-react";

import ConfirmDialog from "./ConfirmDialog";

interface Props {
    precio: number;
    totalNumeros: number;
    disponibles: number;
    onReiniciar: () => Promise<void> | void;
}

export default function AccionesTabla({
    precio,
    totalNumeros,
    disponibles,
    onReiniciar
}: Props) {

    const router = useRouter();

    const [confirmandoReinicio, setConfirmandoReinicio] = useState(false);
    const [reiniciando, setReiniciando] = useState(false);

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

        const url = window.location.href;

        if (navigator.share) {
            await navigator.share({ title: `Tabla $${precio}`, text: "Mira esta dinámica.", url });
            return;
        }

        await navigator.clipboard.writeText(url);
        alert("Enlace copiado.");

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
                    color="bg-red-600 hover:bg-red-700"
                    onClick={() => setConfirmandoReinicio(true)}
                />

                <BotonIcono
                    icon={Pencil}
                    label="Editar"
                    color="bg-blue-600 hover:bg-blue-700"
                    onClick={editar}
                />

                <BotonIcono
                    icon={Share2}
                    label="Compartir"
                    color="bg-emerald-600 hover:bg-emerald-700"
                    onClick={compartir}
                />

                <BotonIcono
                    icon={Shuffle}
                    label="Aleatorio"
                    color="bg-purple-600 hover:bg-purple-700"
                    onClick={aleatorio}
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
    onClick
}: {
    icon: LucideIcon;
    label: string;
    color: string;
    onClick: () => void;
}) {

    return (

        <button
            onClick={onClick}
            aria-label={label}
            title={label}
            className={`flex items-center justify-center gap-2 text-white px-3 sm:px-4 py-2.5 rounded-xl text-sm min-w-[44px] min-h-[44px] ${color}`}
        >
            <Icon size={16} className="shrink-0" />
            <span className="hidden sm:inline">{label}</span>
        </button>

    );

}
