"use client";

import { useState } from "react";

import { Aviso, Button, Field, Input, Modal, avisar } from "@/components/ui";

const formato = (n: number) => `$${n.toLocaleString("es-CO")}`;

// Cambiar el VALOR de una tabla (motor de rifas independientes). Es la misma
// tabla: conserva su tabla_id, números, reservas, pagos, historial y grupos.
export default function EditarValorTablaModal({ open, precioActual, onClose, onGuardar }: {
    open: boolean;
    precioActual: number;
    onClose: () => void;
    onGuardar: (precio: number) => Promise<{ ok: true; gruposAmbiguos: number } | { ok: false; mensaje: string }>;
}) {

    const [valor, setValor] = useState(String(precioActual));
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const precio = Number(valor.replace(/\D/g, ""));

    async function guardar() {
        if (!precio || precio <= 0) { setError("Escribe el valor por número."); return; }
        setEnviando(true);
        setError(null);
        const r = await onGuardar(precio);
        setEnviando(false);
        if (!r.ok) { setError(r.mensaje); return; }
        avisar.ok(`El valor de la tabla ahora es ${formato(precio)}. Sus números, reservas y pagos se conservan.`);
        if (r.gruposAmbiguos > 0) {
            avisar.aviso(`En ${r.gruposAmbiguos} grupo${r.gruposAmbiguos === 1 ? "" : "s"} ya había otra tabla de ${formato(precio)}: el bot no sabrá cuál usar allí hasta que quede una sola.`);
        }
        onClose();
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            bloquearCierre={enviando}
            title="Editar valor de la tabla"
            description="Es la misma tabla: se conservan sus números, reservas, pagos, historial y grupos."
            footer={<>
                <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
                <Button onClick={guardar} loading={enviando} disabled={precio === precioActual}>Guardar</Button>
            </>}
        >
            <div className="flex flex-col gap-4">
                <Field label="Valor por número" htmlFor="editar-tabla-valor" hint={`Valor actual: ${formato(precioActual)}`}>
                    <Input id="editar-tabla-valor" inputMode="numeric" value={valor} onChange={e => setValor(e.target.value)} />
                </Field>
                {error && <Aviso tono="error">{error}</Aviso>}
            </div>
        </Modal>
    );
}
