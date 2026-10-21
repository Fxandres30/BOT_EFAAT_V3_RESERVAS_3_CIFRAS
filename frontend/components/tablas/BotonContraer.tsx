"use client";

import { ChevronDown } from "lucide-react";

interface Props {
    expandido: boolean;
    seccion: string;
    onToggle: () => void;
}

// Botón pequeño para contraer/expandir una sección del panel de la tabla.
// Solo cambia la visibilidad del contenido; el estado vive en la página.
export default function BotonContraer({ expandido, seccion, onToggle }: Props) {

    const label = expandido ? `Ocultar ${seccion}` : `Mostrar ${seccion}`;

    return (

        <button
            type="button"
            onClick={onToggle}
            aria-expanded={expandido}
            aria-label={label}
            title={label}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-colors"
        >
            <ChevronDown
                size={16}
                className={`transition-transform ${expandido ? "rotate-180" : ""}`}
            />
        </button>

    );

}
