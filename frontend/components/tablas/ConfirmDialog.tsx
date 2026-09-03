"use client";

import { AlertTriangle } from "lucide-react";

interface Props {
    abierto: boolean;
    titulo: string;
    descripcion: string;
    detalle?: string;
    textoConfirmar?: string;
    peligroso?: boolean;
    cargando?: boolean;
    onConfirmar: () => void;
    onCancelar: () => void;
}

// Modal de confirmación reusable para acciones destructivas (reiniciar,
// liberar/cancelar una reserva pagada, etc). Siempre explica exactamente
// qué se va a modificar antes de ejecutar nada.
export default function ConfirmDialog({
    abierto,
    titulo,
    descripcion,
    detalle,
    textoConfirmar = "Confirmar",
    peligroso = true,
    cargando = false,
    onConfirmar,
    onCancelar
}: Props) {

    if (!abierto) return null;

    return (

        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
            onClick={onCancelar}
        >

            <div
                className="bg-white rounded-2xl p-5 sm:p-6 w-full max-w-md space-y-4 shadow-xl max-h-[90dvh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >

                <div className="flex items-start gap-3">

                    <div className={`shrink-0 rounded-full p-2 ${peligroso ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
                        <AlertTriangle size={22} />
                    </div>

                    <div>
                        <h2 className="text-lg font-bold text-gray-900">{titulo}</h2>
                        <p className="text-sm text-gray-600 mt-1">{descripcion}</p>
                    </div>

                </div>

                {detalle && (
                    <div className="text-sm bg-gray-50 border rounded-xl p-3 text-gray-700">
                        {detalle}
                    </div>
                )}

                <div className="flex flex-col sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2">

                    <button
                        onClick={onCancelar}
                        disabled={cargando}
                        className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl border text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                        Cancelar
                    </button>

                    <button
                        onClick={onConfirmar}
                        disabled={cargando}
                        className={`w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl text-white disabled:opacity-50 ${
                            peligroso ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                        }`}
                    >
                        {cargando ? "Procesando..." : textoConfirmar}
                    </button>

                </div>

            </div>

        </div>

    );

}
