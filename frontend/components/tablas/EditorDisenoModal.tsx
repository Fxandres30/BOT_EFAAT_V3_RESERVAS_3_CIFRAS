"use client";

import { useState } from "react";
import { Save, FolderPlus, Check } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

import DisenoThumbnail from "./DisenoThumbnail";
import type { TablaDisenoConfig, ColorCelda } from "./disenoTypes";
import { TABLA_DISENO_PRESETS, clonarConfig } from "@/services/tablas/disenoDefaults";

import styles from "./EditorDisenoModal.module.css";

interface Props {
    open: boolean;
    onClose: () => void;
    titulo: string;
    descripcion?: string;
    initialConfig: TablaDisenoConfig;
    guardando?: boolean;
    textoGuardar?: string;
    onGuardar: (config: TablaDisenoConfig) => Promise<void> | void;
    // Solo se ofrece "Guardar como diseño nuevo" cuando se personaliza la
    // tabla en vivo (no al editar una entrada de la biblioteca).
    onGuardarComoNuevo?: (nombre: string, config: TablaDisenoConfig) => Promise<void> | void;
}

function ColorField({
    label,
    value,
    onChange
}: {
    label: string;
    value: string;
    onChange: (valor: string) => void;
}) {

    return (
        <div className={styles.colorField}>
            <input
                type="color"
                value={/^#([0-9a-f]{6})$/i.test(value) ? value : "#000000"}
                onChange={(e) => onChange(e.target.value)}
                aria-label={label}
            />
            <label className={styles.colorFieldLabel}>
                <span>{label}</span>
                <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
            </label>
        </div>
    );

}

export default function EditorDisenoModal({
    open,
    onClose,
    titulo,
    descripcion,
    initialConfig,
    guardando = false,
    textoGuardar = "Guardar cambios",
    onGuardar,
    onGuardarComoNuevo
}: Props) {

    const [config, setConfig] = useState<TablaDisenoConfig>(() => clonarConfig(initialConfig));
    const [mostrarGuardarComo, setMostrarGuardarComo] = useState(false);
    const [nombreNuevo, setNombreNuevo] = useState("");
    const [enviando, setEnviando] = useState(false);

    // Reinicia el formulario con la config real cada vez que el modal pasa
    // de cerrado a abierto — ajuste de estado durante el render (patrón
    // recomendado por React), no un efecto: evita que un "Cancelar" o un
    // guardado previo deje residuos la próxima vez que se abra.
    const [eraAbierto, setEraAbierto] = useState(open);

    if (open && !eraAbierto) {
        setEraAbierto(true);
        setConfig(clonarConfig(initialConfig));
        setMostrarGuardarComo(false);
        setNombreNuevo("");
    } else if (!open && eraAbierto) {
        setEraAbierto(false);
    }

    function actualizarCelda(clave: keyof TablaDisenoConfig["cells"], campo: keyof ColorCelda, valor: string) {
        setConfig((prev) => ({
            ...prev,
            cells: { ...prev.cells, [clave]: { ...prev.cells[clave], [campo]: valor } }
        }));
    }

    function aplicarPreset(presetConfig: TablaDisenoConfig) {
        setConfig(clonarConfig(presetConfig));
    }

    async function guardar() {
        setEnviando(true);
        try {
            await onGuardar(config);
            onClose();
        } catch (e) {
            alert(e instanceof Error ? e.message : "No se pudo guardar el diseño.");
        } finally {
            setEnviando(false);
        }
    }

    async function guardarComoNuevo() {
        if (!onGuardarComoNuevo || !nombreNuevo.trim()) return;
        setEnviando(true);
        try {
            await onGuardarComoNuevo(nombreNuevo.trim(), config);
            setMostrarGuardarComo(false);
            setNombreNuevo("");
        } catch (e) {
            alert(e instanceof Error ? e.message : "No se pudo crear el diseño.");
        } finally {
            setEnviando(false);
        }
    }

    const ocupado = guardando || enviando;

    return (

        <Modal
            open={open}
            onClose={onClose}
            size="lg"
            title={titulo}
            description={descripcion}
            footer={
                <>
                    <Button variant="ghost" onClick={onClose} disabled={ocupado}>
                        Cancelar
                    </Button>
                    {onGuardarComoNuevo && (
                        <Button
                            variant="secondary"
                            leftIcon={<FolderPlus size={14} />}
                            onClick={() => setMostrarGuardarComo((v) => !v)}
                            disabled={ocupado}
                        >
                            Guardar como diseño
                        </Button>
                    )}
                    <Button leftIcon={<Save size={14} />} onClick={guardar} loading={enviando}>
                        {textoGuardar}
                    </Button>
                </>
            }
        >
            <div className={styles.body}>

                <div className={styles.previewRow}>
                    <DisenoThumbnail config={config} />
                </div>

                {mostrarGuardarComo && onGuardarComoNuevo && (
                    <div className={styles.saveAsRow}>
                        <Input
                            label="Nombre del diseño"
                            placeholder="Ej: Azul EFAAT"
                            value={nombreNuevo}
                            onChange={(e) => setNombreNuevo(e.target.value)}
                            autoFocus
                        />
                        <Button
                            size="sm"
                            leftIcon={<Check size={14} />}
                            onClick={guardarComoNuevo}
                            disabled={!nombreNuevo.trim() || ocupado}
                        >
                            Crear
                        </Button>
                    </div>
                )}

                <div className={styles.section}>
                    <span className={styles.sectionTitle}>Presets</span>
                    <div className={styles.presets}>
                        {TABLA_DISENO_PRESETS.map((preset) => (
                            <button
                                key={preset.key}
                                type="button"
                                className={styles.presetChip}
                                onClick={() => aplicarPreset(preset.config)}
                            >
                                <span
                                    className={styles.presetDot}
                                    style={{ background: preset.config.theme.accent }}
                                />
                                {preset.nombre}
                            </button>
                        ))}
                    </div>
                </div>

                <div className={styles.section}>
                    <span className={styles.sectionTitle}>Colores generales</span>
                    <div className={styles.colorGrid}>
                        <ColorField label="Fondo de tabla" value={config.theme.tableBg} onChange={(v) => setConfig((p) => ({ ...p, theme: { ...p.theme, tableBg: v } }))} />
                        <ColorField label="Texto" value={config.theme.text} onChange={(v) => setConfig((p) => ({ ...p, theme: { ...p.theme, text: v } }))} />
                        <ColorField label="Bordes" value={config.theme.border} onChange={(v) => setConfig((p) => ({ ...p, theme: { ...p.theme, border: v } }))} />
                        <ColorField label="Acento" value={config.theme.accent} onChange={(v) => setConfig((p) => ({ ...p, theme: { ...p.theme, accent: v } }))} />
                    </div>
                </div>

                <div className={styles.section}>
                    <span className={styles.sectionTitle}>Disponible</span>
                    <div className={styles.colorGrid}>
                        <ColorField label="Fondo" value={config.cells.available.bg} onChange={(v) => actualizarCelda("available", "bg", v)} />
                        <ColorField label="Borde" value={config.cells.available.border} onChange={(v) => actualizarCelda("available", "border", v)} />
                        <ColorField label="Texto" value={config.cells.available.text} onChange={(v) => actualizarCelda("available", "text", v)} />
                    </div>
                </div>

                <div className={styles.section}>
                    <span className={styles.sectionTitle}>Reservado</span>
                    <div className={styles.colorGrid}>
                        <ColorField label="Fondo" value={config.cells.reserved.bg} onChange={(v) => actualizarCelda("reserved", "bg", v)} />
                        <ColorField label="Borde" value={config.cells.reserved.border} onChange={(v) => actualizarCelda("reserved", "border", v)} />
                        <ColorField label="Texto" value={config.cells.reserved.text} onChange={(v) => actualizarCelda("reserved", "text", v)} />
                    </div>
                </div>

                <div className={styles.section}>
                    <span className={styles.sectionTitle}>Pagado</span>
                    <div className={styles.colorGrid}>
                        <ColorField label="Fondo" value={config.cells.pagado.bg} onChange={(v) => actualizarCelda("pagado", "bg", v)} />
                        <ColorField label="Borde" value={config.cells.pagado.border} onChange={(v) => actualizarCelda("pagado", "border", v)} />
                        <ColorField label="Texto" value={config.cells.pagado.text} onChange={(v) => actualizarCelda("pagado", "text", v)} />
                    </div>
                </div>

                <div className={styles.section}>
                    <span className={styles.sectionTitle}>Apariencia de números</span>
                    <div className={styles.numberGrid}>
                        <Input
                            label="Tamaño (px)"
                            type="number"
                            min={10}
                            max={28}
                            value={config.numbers.size}
                            onChange={(e) => setConfig((p) => ({ ...p, numbers: { ...p.numbers, size: Number(e.target.value) || p.numbers.size } }))}
                        />
                        <Select
                            label="Peso"
                            value={String(config.numbers.weight)}
                            onChange={(e) => setConfig((p) => ({ ...p, numbers: { ...p.numbers, weight: Number(e.target.value) } }))}
                        >
                            <option value="400">Normal</option>
                            <option value="500">Medio</option>
                            <option value="600">Semi negrita</option>
                            <option value="700">Negrita</option>
                            <option value="800">Extra negrita</option>
                        </Select>
                        <Input
                            label="Radio (px)"
                            type="number"
                            min={0}
                            max={24}
                            value={config.grid.radius}
                            onChange={(e) => setConfig((p) => ({ ...p, grid: { ...p.grid, radius: Number(e.target.value) } }))}
                        />
                        <Input
                            label="Separación (px)"
                            type="number"
                            min={2}
                            max={16}
                            value={config.grid.spacing}
                            onChange={(e) => setConfig((p) => ({ ...p, grid: { ...p.grid, spacing: Number(e.target.value) } }))}
                        />
                        <Input
                            label="Grosor de borde (px)"
                            type="number"
                            min={0}
                            max={4}
                            value={config.grid.borderWidth}
                            onChange={(e) => setConfig((p) => ({ ...p, grid: { ...p.grid, borderWidth: Number(e.target.value) } }))}
                        />
                    </div>
                </div>

            </div>
        </Modal>

    );

}
