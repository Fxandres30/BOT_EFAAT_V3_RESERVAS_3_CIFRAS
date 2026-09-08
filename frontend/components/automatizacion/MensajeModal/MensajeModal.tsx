"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";

import { AutomationMessage, crearMensaje, actualizarMensaje } from "@/services/automatizacion/mensajesAutomation";
import { TIPOS_AUTOMATIZACION, CATEGORIAS_AUTOMATIZACION, VARIABLES_PERMITIDAS } from "@/services/automatizacion/tiposCategorias";

import styles from "./MensajeModal.module.css";

interface Props {
    usuarioId: string;
    mensaje: AutomationMessage | null; // null = creando uno nuevo
    onClose: () => void;
    onGuardado: (m: AutomationMessage) => void;
}

export default function MensajeModal({ usuarioId, mensaje, onClose, onGuardado }: Props) {

    const [nombreInterno, setNombreInterno] = useState(mensaje?.nombre_interno || "");
    const [texto, setTexto] = useState(mensaje?.texto || "");
    const [tipo, setTipo] = useState(mensaje?.tipo || TIPOS_AUTOMATIZACION[0].id);
    const [categoria, setCategoria] = useState(mensaje?.categoria || "");
    const [activo, setActivo] = useState(mensaje?.activo ?? true);

    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const esGlobalAjeno = !!mensaje && mensaje.usuario_id !== usuarioId;

    async function guardar() {

        if (!nombreInterno.trim() || !texto.trim()) {
            setError("Nombre interno y mensaje son obligatorios.");
            return;
        }

        setGuardando(true);
        setError(null);

        const datos = {
            nombre_interno: nombreInterno.trim(),
            texto: texto.trim(),
            tipo,
            categoria: categoria || null,
            activo
        };

        const { data, error: errorGuardar } = mensaje && !esGlobalAjeno
            ? await actualizarMensaje(mensaje.id, datos)
            : await crearMensaje(usuarioId, datos);

        setGuardando(false);

        if (errorGuardar || !data) {
            setError(`No se pudo guardar (${errorGuardar?.message || "error desconocido"}).`);
            return;
        }

        onGuardado(data as AutomationMessage);

    }

    const titulo = mensaje ? (esGlobalAjeno ? "Ver mensaje global" : "Editar mensaje") : "Nuevo mensaje";

    return (

        <Modal
            open
            onClose={onClose}
            title={titulo}
            size="md"
            footer={
                <>
                    <Button variant="ghost" onClick={onClose} disabled={guardando}>
                        {esGlobalAjeno ? "Cerrar" : "Cancelar"}
                    </Button>
                    {!esGlobalAjeno && (
                        <Button onClick={guardar} loading={guardando}>Guardar</Button>
                    )}
                </>
            }
        >
            <div className={styles.form}>

                {esGlobalAjeno && (
                    <p className={styles.aviso}>
                        Este mensaje es global y no te pertenece — solo puedes verlo. Usa
                        &quot;Duplicar como propio&quot; en la tarjeta para crear tu propia copia editable.
                    </p>
                )}

                <Input
                    label="Nombre interno"
                    value={nombreInterno}
                    disabled={esGlobalAjeno}
                    onChange={(e) => setNombreInterno(e.target.value)}
                    placeholder="Ej: apertura-competencia-1"
                />

                <Textarea
                    label="Mensaje"
                    rows={4}
                    value={texto}
                    disabled={esGlobalAjeno}
                    onChange={(e) => setTexto(e.target.value)}
                    placeholder="¡Ya arrancamos {nombre_evento}!"
                />

                <div className={styles.variables}>
                    Variables permitidas:
                    {VARIABLES_PERMITIDAS.map((v) => (
                        <code key={v.variable} title={v.descripcion}>{v.variable}</code>
                    ))}
                </div>

                <div className={styles.row}>

                    <Select
                        label="Tipo"
                        value={tipo}
                        disabled={esGlobalAjeno}
                        onChange={(e) => setTipo(e.target.value)}
                    >
                        {TIPOS_AUTOMATIZACION.map((t) => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                    </Select>

                    <Select
                        label="Categoría"
                        value={categoria}
                        disabled={esGlobalAjeno}
                        onChange={(e) => setCategoria(e.target.value)}
                    >
                        <option value="">Sin categoría</option>
                        {CATEGORIAS_AUTOMATIZACION.map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                    </Select>

                </div>

                <label className={styles.switch}>
                    <input
                        type="checkbox"
                        checked={activo}
                        disabled={esGlobalAjeno}
                        onChange={(e) => setActivo(e.target.checked)}
                    />
                    Activo
                </label>

                {error && (
                    <p className={styles.error}>
                        <AlertTriangle size={13} /> {error}
                    </p>
                )}

            </div>
        </Modal>

    );

}
