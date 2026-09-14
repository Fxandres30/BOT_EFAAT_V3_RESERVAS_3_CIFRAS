// Proxy hacia POST /api/contactos/telefono -> backend
// POST /contactos/:id/telefono. Botón "Agregar teléfono" del panel.
export interface ResultadoAgregarTelefono {
    ok: boolean;
    motivo?: string;
    sinCambios?: boolean;
    usuario?: { id: string; telefono: string | null; nombre: string | null; lid: string | null };
}

export async function agregarTelefonoContacto(
    id: string,
    telefono: string
): Promise<ResultadoAgregarTelefono> {

    const res = await fetch("/api/contactos/telefono", {

        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({ id, telefono })

    });

    return await res.json();

}
