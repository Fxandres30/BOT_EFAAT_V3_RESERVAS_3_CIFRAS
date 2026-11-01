"use client";

import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Star } from "lucide-react";

import { Badge, Button, Textarea } from "@/components/ui";
import {
    apiSorteos,
    describirError,
    type CatalogoEstilos,
    type DatosMensaje,
    type MensajeGenerado
} from "@/services/sorteos/apiSorteos";
import styles from "./SelectorMensaje.module.css";

/** Lo que el sorteo guarda de su mensaje de publicación. */
export interface ValorMensaje {
    /** Texto con {{variables}} (se resuelven al publicar). */
    texto: string;
    /** Estilo del catálogo ("" = aún sin elegir). */
    estilo: string;
    /** false: se publica solo la imagen; el texto se conserva. */
    activo: boolean;
}

interface Props {
    valor: ValorMensaje;
    onChange: (valor: ValorMensaje) => void;
    /** Datos reales del sorteo para la vista previa. */
    datos: DatosMensaje;
    error?: string;
    /** Sorteo nuevo: si no trae estilo se propone el predeterminado de la cuenta. */
    sorteoNuevo?: boolean;
    /** Interruptor activo/inactivo (no en los sorteos detectados). */
    permitirActivar?: boolean;
    /** Rellenar un texto vacío con la plantilla de su estilo al cargar o al
     *  cambiar `semilla` (p. ej. al aplicar una plantilla de sorteo). Nunca
     *  pisa un texto escrito. */
    rellenarVacio?: boolean;
    semilla?: number;
    /** Explicación propia del contexto (p. ej. qué pasa al guardar). */
    nota?: string;
}

type Catalogo =
    | { tipo: "cargando" }
    | { tipo: "ok"; catalogo: CatalogoEstilos }
    | { tipo: "error" };

type Vista =
    | { tipo: "vacia" }
    | { tipo: "ok"; mensaje: MensajeGenerado }
    | { tipo: "error"; mensaje: string };

const ESTILO_CLASICO = "clasico";

// Mensaje de publicación de un sorteo: galería de diseños, editor con
// contador, vista previa con los datos reales (generada en el servidor con
// el MISMO generador que el publicador), activo/inactivo y restaurar el
// diseño original. Lo guardado se muestra tal cual: al abrir un sorteo
// nunca se regenera su texto; solo un texto vacío se rellena con su diseño.
export default function SelectorMensaje({
    valor, onChange, datos, error, sorteoNuevo = false, permitirActivar = true, rellenarVacio = true, semilla = 0, nota
}: Props) {

    const [catalogo, setCatalogo] = useState<Catalogo>({ tipo: "cargando" });
    const [vista, setVista] = useState<Vista>({ tipo: "vacia" });
    const [generando, setGenerando] = useState(false);
    const [guardandoPreferencia, setGuardandoPreferencia] = useState(false);
    const [avisoPreferencia, setAvisoPreferencia] = useState<string | null>(null);

    // Últimos valores para los efectos asíncronos (sin volver a dispararlos).
    const actual = useRef({ valor, onChange, sorteoNuevo, rellenarVacio });
    useEffect(() => { actual.current = { valor, onChange, sorteoNuevo, rellenarVacio }; });

    const lista = catalogo.tipo === "ok" ? catalogo.catalogo : null;
    const estiloDe = (id: string) => lista?.estilos.find(e => e.id === id) || null;
    const estiloActual = estiloDe(valor.estilo) || estiloDe(ESTILO_CLASICO);
    const plantillaActual = estiloActual?.plantilla ?? "";
    const personalizado = Boolean(lista && valor.texto && valor.texto.trim() !== plantillaActual);
    const limite = lista?.limite ?? 4000;

    useEffect(() => {
        let vigente = true;
        apiSorteos.estilosMensaje().then(r => {
            if (!vigente) return;
            if (!r.ok) {
                describirError(r);
                setCatalogo({ tipo: "error" });
                return;
            }
            setCatalogo({ tipo: "ok", catalogo: r.data });
        });
        return () => { vigente = false; };
    }, []);

    // Texto vacío (sorteo nuevo, sorteo antiguo sin texto guardado o recién
    // aplicada una plantilla de sorteo): se rellena con la plantilla de su
    // diseño, la misma que se publicaría.
    useEffect(() => {
        if (catalogo.tipo !== "ok") return;
        const { valor: v, onChange: cambiar, sorteoNuevo: nuevo, rellenarVacio: rellenar } = actual.current;
        if (!rellenar || v.texto) return;
        const c = catalogo.catalogo;
        const elegido = c.estilos.find(e => e.id === v.estilo)
            || c.estilos.find(e => e.id === (nuevo ? c.predeterminado : ESTILO_CLASICO))
            || c.estilos[0];
        if (elegido) cambiar({ ...v, texto: elegido.plantilla, estilo: elegido.id });
    }, [catalogo, semilla]);

    // Vista previa con los datos reales (servidor), con una pausa mientras se escribe.
    const datosClave = JSON.stringify(datos);
    useEffect(() => {
        if (catalogo.tipo !== "ok") return;
        let vigente = true;
        const t = setTimeout(async () => {
            setGenerando(true);
            const r = await apiSorteos.generarMensaje({ estilo: valor.estilo || undefined, texto: valor.texto, datos: JSON.parse(datosClave) as DatosMensaje });
            if (!vigente) return;
            setGenerando(false);
            setVista(r.ok ? { tipo: "ok", mensaje: r.data } : { tipo: "error", mensaje: describirError(r) });
        }, 450);
        return () => { vigente = false; clearTimeout(t); };
    }, [catalogo.tipo, valor.texto, valor.estilo, datosClave]);

    function elegir(id: string) {
        const e = estiloDe(id);
        if (!e || (id === valor.estilo && !personalizado)) return;
        if (personalizado && !window.confirm(`Cambiar al diseño «${e.nombre}» reemplazará tu texto personalizado. ¿Continuar?`)) return;
        onChange({ ...valor, estilo: e.id, texto: e.plantilla });
    }

    function restaurar() {
        if (!estiloActual) return;
        if (!window.confirm(`Se eliminará tu texto personalizado y se usará el diseño «${estiloActual.nombre}» original. El sorteo no se elimina. ¿Continuar?`)) return;
        onChange({ ...valor, estilo: estiloActual.id, texto: estiloActual.plantilla });
    }

    async function usarPorDefecto() {
        if (!lista || !estiloActual) return;
        setGuardandoPreferencia(true);
        setAvisoPreferencia(null);
        const r = await apiSorteos.guardarEstiloPredeterminado(estiloActual.id);
        setGuardandoPreferencia(false);
        if (!r.ok) {
            setAvisoPreferencia(describirError(r));
            return;
        }
        setCatalogo({ tipo: "ok", catalogo: { ...lista, predeterminado: r.data.estilo } });
        setAvisoPreferencia(`«${estiloActual.nombre}» será el diseño de tus sorteos nuevos.`);
    }

    const interruptor = permitirActivar && (
        <div className={styles.estado}>
            <label className={styles.interruptor}>
                <input type="checkbox" role="switch" checked={valor.activo} onChange={e => onChange({ ...valor, activo: e.target.checked })} />
                <span className={styles.pista} aria-hidden="true" />
                <span>Publicar este mensaje con la imagen</span>
            </label>
            <Badge tone={valor.activo ? "success" : "warning"} dot>{valor.activo ? "Activo" : "Inactivo"}</Badge>
        </div>
    );

    const avisoInactivo = permitirActivar && !valor.activo && (
        <p className={styles.avisoInactivo} role="status">
            Mensaje <b>inactivo</b>: se publicará solo la imagen de la tabla, sin texto. El contenido queda guardado y puedes reactivarlo cuando quieras.
        </p>
    );

    // Sin catálogo (p. ej. servidor sin esta función): el campo de siempre.
    if (catalogo.tipo === "error") {
        return (
            <div className={styles.contenedor}>
                {interruptor}
                {avisoInactivo}
                <Textarea label="Mensaje de publicación" optional rows={8} value={valor.texto} onChange={e => onChange({ ...valor, texto: e.target.value })} error={error}
                    hint={`No pudimos cargar los diseños. Puedes escribir el mensaje; vacío = diseño clásico.${nota ? ` ${nota}` : ""}`} />
            </div>
        );
    }

    if (catalogo.tipo === "cargando" || !lista) {
        return <p className={styles.ayuda} role="status">Cargando los diseños del mensaje…</p>;
    }

    const generado = vista.tipo === "ok" ? vista.mensaje : null;

    return (
        <div className={styles.contenedor}>

            {interruptor}
            {avisoInactivo}

            <div>
                <p className={styles.etiqueta} id="titulo-disenos">Diseño del mensaje</p>
                <div className={styles.galeria} role="radiogroup" aria-labelledby="titulo-disenos">
                    {lista.estilos.map(e => {
                        const elegido = e.id === estiloActual?.id;
                        return (
                            <button
                                key={e.id}
                                type="button"
                                role="radio"
                                aria-checked={elegido}
                                className={`${styles.tarjeta} ${elegido ? styles.tarjetaElegida : ""}`}
                                onClick={() => elegir(e.id)}
                                title={e.descripcion}
                            >
                                <span className={styles.tarjetaCabecera}>
                                    <span className={styles.tarjetaNombre}>{e.nombre}</span>
                                    {elegido && <Check size={14} aria-hidden="true" className={styles.marca} />}
                                </span>
                                <pre className={styles.miniatura} aria-hidden="true">{e.ejemplo}</pre>
                                {e.id === lista.predeterminado && <span className={styles.predeterminado}><Star size={11} aria-hidden="true" /> Tu predeterminado</span>}
                            </button>
                        );
                    })}
                </div>
            </div>

            {estiloActual && (
                <div className={styles.elegido}>
                    <div>
                        <p className={styles.elegidoNombre}>
                            {estiloActual.nombre}
                            {personalizado && <Badge tone="primary" size="sm">Personalizado</Badge>}
                        </p>
                        <p className={styles.ayuda}>{estiloActual.descripcion}</p>
                    </div>
                    <div className={styles.acciones}>
                        <Button size="sm" variant="secondary" leftIcon={<RotateCcw size={14} />} onClick={restaurar} disabled={!personalizado}>Restaurar diseño original</Button>
                        {lista.preferencias_disponibles && estiloActual.id !== lista.predeterminado && (
                            <Button size="sm" variant="ghost" leftIcon={<Star size={14} />} onClick={usarPorDefecto} loading={guardandoPreferencia}>Usar por defecto en mi cuenta</Button>
                        )}
                    </div>
                </div>
            )}
            {avisoPreferencia && <p className={styles.ayuda} role="status">{avisoPreferencia}</p>}

            <div className={styles.editorYVista}>
                <div className={styles.columna}>
                    <Textarea
                        label="Mensaje de publicación"
                        rows={12}
                        value={valor.texto}
                        onChange={e => onChange({ ...valor, texto: e.target.value })}
                        error={error || (generado?.desconocidas.length ? `Variables que no existen: ${generado.desconocidas.map(v => `{{${v}}}`).join(", ")}. Se enviarían tal cual: corrígelas.` : undefined)}
                        hint={`Las {{variables}} se reemplazan con los datos del sorteo al publicar. Si lo dejas vacío se usará el diseño original.${nota ? ` ${nota}` : ""}`}
                        className={styles.editor}
                    />
                    <p className={`${styles.contador} ${generado?.excede ? styles.contadorExcede : ""}`} aria-live="polite">
                        {valor.texto.length.toLocaleString("es-CO")} caracteres escritos
                        {generado && <> · <b>{generado.longitud.toLocaleString("es-CO")}</b> / {limite.toLocaleString("es-CO")} al publicar</>}
                    </p>
                    <details className={styles.variables}>
                        <summary>Variables disponibles</summary>
                        <ul>
                            {Object.entries(lista.variables).map(([clave, descripcion]) => (
                                <li key={clave}><code>{`{{${clave}}}`}</code> {descripcion}</li>
                            ))}
                        </ul>
                    </details>
                </div>

                <div className={styles.columna}>
                    <p className={styles.etiqueta}>
                        Vista previa con los datos del sorteo {generando && <span className={styles.ayuda}>· actualizando…</span>}
                    </p>
                    {vista.tipo === "error" ? (
                        <p className={styles.avisoInactivo} role="alert">No pudimos generar la vista previa: {vista.mensaje}</p>
                    ) : (
                        <pre className={`${styles.vista} ${permitirActivar && !valor.activo ? styles.vistaInactiva : ""}`}>
                            {generado ? generado.texto : "Generando…"}
                        </pre>
                    )}
                    {permitirActivar && !valor.activo && <p className={styles.ayuda}>Este texto no se enviará mientras el mensaje esté inactivo.</p>}
                    {generado?.excede && <p className={styles.contadorExcede}>Supera el máximo de {limite.toLocaleString("es-CO")} caracteres: acórtalo o elige un diseño más compacto.</p>}
                </div>
            </div>

        </div>
    );

}
