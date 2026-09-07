"use client";

import { QrCode, X } from "lucide-react";

interface Props {
    abierto: boolean;
    emailCuenta: string | null;
    onCerrar: () => void;
}

// Modal PREPARADO para la vinculación real (QR / código temporal), que se
// implementará cuando exista el endpoint de alta de dispositivos desde el
// panel (ver backend/pagos/README.md, fase P2). Por ahora es solo la
// cáscara visual: no genera ningún QR, no llama a ningún endpoint y no
// muestra ninguna credencial de dispositivo.
export default function VincularTelefonoModal({
    abierto,
    emailCuenta,
    onCerrar
}: Props) {

    if (!abierto) return null;

    return (

        <div
            className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4"
            onClick={onCerrar}
        >

            <div
                className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[85dvh]"
                onClick={(e) => e.stopPropagation()}
            >

                <div className="sm:hidden flex justify-center pt-2 shrink-0">
                    <span className="h-1.5 w-12 rounded-full bg-black/10" />
                </div>

                <div className="shrink-0 p-4 sm:p-5 flex items-center justify-between border-b">

                    <div className="min-w-0">
                        <h2 className="font-bold text-gray-900">Vincular teléfono</h2>
                        {emailCuenta && (
                            <p className="text-xs text-gray-500 truncate">Cuenta: {emailCuenta}</p>
                        )}
                    </div>

                    <button
                        onClick={onCerrar}
                        aria-label="Cerrar"
                        className="text-gray-400 hover:text-gray-700 p-2 -m-2 rounded-full shrink-0"
                    >
                        <X size={20} />
                    </button>

                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">

                    <div className="aspect-square w-full max-w-[220px] mx-auto rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 flex flex-col items-center justify-center gap-2 text-gray-400">
                        <QrCode size={40} strokeWidth={1.25} />
                        <span className="text-xs font-medium">Código QR próximamente</span>
                    </div>

                    <p className="text-sm text-gray-600 text-center">
                        Aquí aparecerá un código QR o un código temporal para vincular tu
                        teléfono con esta cuenta EFAAT, una vez que instales la aplicación.
                    </p>

                    <p className="text-xs text-gray-400 text-center">
                        Esta función todavía no está disponible.
                    </p>

                </div>

                <div className="shrink-0 p-4 sm:p-5 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-5 border-t bg-gray-50">
                    <button
                        onClick={onCerrar}
                        className="w-full flex items-center justify-center gap-2 text-sm font-medium text-white bg-gray-800 hover:bg-black px-4 py-2.5 rounded-xl"
                    >
                        Entendido
                    </button>
                </div>

            </div>

        </div>

    );

}
