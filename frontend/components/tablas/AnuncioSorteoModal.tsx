"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ChevronRight, CircleDashed, History, Plus, Zap } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import FormularioSorteo from "@/components/sorteos/FormularioSorteo";
import VistaPreviaModal from "@/components/sorteos/VistaPreviaModal";
import EditarSorteoActivoModal from "@/components/sorteos/EditarSorteoActivoModal";
import { esEditable } from "@/components/sorteos/ListaSorteos";
import { apiSorteos, describirError } from "@/services/sorteos/apiSorteos";
import styles from "./AnuncioSorteoModal.module.css";

interface Props {
    precio: number;
    onClose: () => void;
}

export type ModalidadSorteo = "instantaneo" | "programado";

type Paso =
    | { tipo: "buscando" }
    | { tipo: "error"; mensaje: string }
    // Ni sorteo activo ni programado editable: situación NORMAL (no un
    // error). Se explica y cada acción es explícita.
    | { tipo: "sin_editable"; publicado: string | null }
    // «Crear sorteo nuevo»: el administrador elige la modalidad ANTES del
    // formulario. Sin elección no se continúa (nunca hay una por defecto).
    | { tipo: "modalidad"; publicado: string | null; elegida: ModalidadSorteo | null }
    // Sorteo EN CURSO de esta tabla (detectado por el bot o del panel).
    | { tipo: "activo"; eventoId: string }
    // sorteoId = edición (la modalidad es la GUARDADA en el sorteo);
    // sin sorteoId = nuevo con la modalidad elegida.
    | { tipo: "formulario"; sorteoId: string | null; modalidad: ModalidadSorteo | null }
    | { tipo: "vista_previa"; sorteoId: string };

const MODALIDADES: { valor: ModalidadSorteo; titulo: string; icono: typeof Zap; descripcion: string; detalle: string }[] = [
    {
        valor: "instantaneo",
        titulo: "Sorteo instantáneo",
        icono: Zap,
        descripcion: "Se publica en el momento en que lo confirmes.",
        detalle: "Sin fecha ni hora de publicación. Configuras lotería, fecha y hora del sorteo, precio, premios y grupos; revisas la vista previa y decides cuándo pulsar «Publicar ahora»."
    },
    {
        valor: "programado",
        titulo: "Sorteo programado",
        icono: CalendarClock,
        descripcion: "Se publica solo en la fecha y hora que elijas.",
        detalle: "Indicas la fecha y hora de publicación, además de la fecha y hora del sorteo, el cierre de reservas y los grupos. Lo revisas y confirmas en la vista previa."
    }
];

// Botón «Editar» de /tablas/[precio]. Abre el sorteo de ESTA tabla sea cual
// sea su origen, en este orden:
//   1. el sorteo activo de la tabla y el precio (eventos_bot: lo haya
//      detectado el bot o publicado el panel) -> edición de lo que se puede
//      cambiar con el sorteo en curso;
//   2. si no hay, el sorteo programado más reciente que aún no se publicó
//      -> formulario completo con SU modalidad (lo pide al backend por id);
//   3. si no hay ninguno -> ventana «Sin sorteo activo» con «Ver el último
//      sorteo» y «Crear sorteo nuevo», que pide elegir instantáneo o
//      programado antes de abrir el formulario.
// Si algo no carga, error con «Reintentar»: nunca un formulario vacío.
export default function AnuncioSorteoModal({ precio, onClose }: Props) {

    const [paso, setPaso] = useState<Paso>({ tipo: "buscando" });
    const [intento, setIntento] = useState(0);

    // AccionesTabla monta este componente cada vez que se pulsa «Editar»:
    // la búsqueda corre una vez por apertura (y por cada «Reintentar»).
    useEffect(() => {

        let vivo = true;

        async function buscar() {

            const [activos, lista] = await Promise.all([apiSorteos.activos(precio), apiSorteos.listar()]);

            if (!vivo) return;

            if (!activos.ok) return setPaso({ tipo: "error", mensaje: describirError(activos) });
            if (activos.data.length) return setPaso({ tipo: "activo", eventoId: activos.data[0].id });

            if (!lista.ok) return setPaso({ tipo: "error", mensaje: describirError(lista) });

            const delPrecio = lista.data
                .filter(s => Number(s.config.valor) === precio && s.estado !== "cancelado")
                .sort((a, b) => new Date(b.publicar_en).getTime() - new Date(a.publicar_en).getTime());

            if (!delPrecio.length) return setPaso({ tipo: "sin_editable", publicado: null });

            // El listado no trae los grupos: hacen falta para saber si ya se
            // publicó en alguno. Un detalle que falla NO se da por editable.
            const detalles = await Promise.all(delPrecio.map(s => apiSorteos.obtener(s.id)));

            if (!vivo) return;

            const fallo = detalles.find(d => !d.ok);
            if (fallo && !fallo.ok) return setPaso({ tipo: "error", mensaje: describirError(fallo) });

            const completos = detalles.flatMap(d => (d.ok ? [d.data] : []));
            const editable = completos.find(esEditable);

            if (editable) setPaso({ tipo: "formulario", sorteoId: editable.id, modalidad: null });
            else setPaso({ tipo: "sin_editable", publicado: completos[0]?.id || null });

        }

        buscar();

        return () => { vivo = false; };

    }, [precio, intento]);

    const textoPrecio = `$${precio.toLocaleString("es-CO")}`;
    const enGestion = paso.tipo === "buscando" || paso.tipo === "error" || paso.tipo === "sin_editable" || paso.tipo === "modalidad";

    const titulo = paso.tipo === "modalidad" ? `Nuevo sorteo · tabla ${textoPrecio}` : `Sorteo de la tabla ${textoPrecio}`;

    const footer = paso.tipo === "modalidad" ? (
        <div className={styles.pie}>
            <Button variant="secondary" onClick={() => setPaso({ tipo: "sin_editable", publicado: paso.publicado })}>Volver</Button>
            <Button
                rightIcon={<ChevronRight size={16} />}
                disabled={!paso.elegida}
                onClick={() => paso.elegida && setPaso({ tipo: "formulario", sorteoId: null, modalidad: paso.elegida })}
            >
                Continuar
            </Button>
        </div>
    ) : (
        <div className={styles.pie}>
            {paso.tipo === "error" && (
                <Button variant="secondary" onClick={() => { setPaso({ tipo: "buscando" }); setIntento(n => n + 1); }}>Reintentar</Button>
            )}
            <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
    );

    return (
        <>
            <Modal open={enGestion} onClose={onClose} title={titulo} size="md" footer={footer}>
                {paso.tipo === "sin_editable" ? (
                    <div className={styles.cuerpo}>

                        <div className={styles.estado} role="status">
                            <span className={styles.estadoIcono} aria-hidden><CircleDashed size={22} /></span>
                            <div>
                                <p className={styles.estadoTitulo}>Sin sorteo activo</p>
                                <p className={styles.estadoTexto}>
                                    Esta tabla no tiene ningún sorteo activo ni programado pendiente de publicar.
                                    {" "}Es una situación normal: los números conservan su último estado y la tabla está lista para un sorteo nuevo.
                                </p>
                            </div>
                        </div>

                        <div className={styles.acciones} aria-label="Acciones disponibles">
                            <button type="button" className={`${styles.accion} ${styles.accionPrincipal}`}
                                onClick={() => setPaso({ tipo: "modalidad", publicado: paso.publicado, elegida: null })}>
                                <span className={styles.accionIcono} aria-hidden><Plus size={20} /></span>
                                <span className={styles.accionTexto}>
                                    <span className={styles.accionTitulo}>Crear sorteo nuevo</span>
                                    <span className={styles.accionDescripcion}>Elige si se publica ahora (instantáneo) o en una fecha y hora (programado).</span>
                                </span>
                                <ChevronRight size={18} className={styles.accionFlecha} aria-hidden />
                            </button>

                            {paso.publicado ? (
                                <button type="button" className={styles.accion}
                                    onClick={() => setPaso({ tipo: "vista_previa", sorteoId: paso.publicado as string })}>
                                    <span className={styles.accionIcono} aria-hidden><History size={20} /></span>
                                    <span className={styles.accionTexto}>
                                        <span className={styles.accionTitulo}>Ver el último publicado</span>
                                        <span className={styles.accionDescripcion}>Consulta el anuncio, la tabla y los grupos del último sorteo de este precio. No cambia nada.</span>
                                    </span>
                                    <ChevronRight size={18} className={styles.accionFlecha} aria-hidden />
                                </button>
                            ) : (
                                <p className={styles.nota}>Todavía no hay sorteos anteriores de este precio para consultar.</p>
                            )}
                        </div>

                    </div>
                ) : paso.tipo === "modalidad" ? (
                    <div className={styles.cuerpo}>
                        <p className={styles.estadoTexto}>¿Cómo quieres publicar este sorteo? Elige una modalidad para continuar. Nada se publica hasta que revises la vista previa y lo confirmes.</p>
                        <div className={styles.modalidades} role="radiogroup" aria-label="Modalidad del sorteo">
                            {MODALIDADES.map(m => {
                                const Icono = m.icono;
                                const marcada = paso.elegida === m.valor;
                                return (
                                    <label key={m.valor} className={`${styles.modalidad} ${marcada ? styles.modalidadMarcada : ""}`}>
                                        <input
                                            type="radio"
                                            name="modalidad-sorteo"
                                            value={m.valor}
                                            checked={marcada}
                                            onChange={() => setPaso({ ...paso, elegida: m.valor })}
                                            className={styles.radio}
                                        />
                                        <span className={styles.accionIcono} aria-hidden><Icono size={20} /></span>
                                        <span className={styles.accionTexto}>
                                            <span className={styles.accionTitulo}>{m.titulo}</span>
                                            <span className={styles.modalidadResumen}>{m.descripcion}</span>
                                            <span className={styles.accionDescripcion}>{m.detalle}</span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                ) : paso.tipo === "error" ? (
                    <p role="alert" className={styles.error}>No se pudo cargar el sorteo de esta tabla: {paso.mensaje}</p>
                ) : (
                    <p role="status" className={styles.estadoTexto}>Cargando el sorteo de esta tabla…</p>
                )}
            </Modal>

            {paso.tipo === "activo" && (
                <EditarSorteoActivoModal
                    key={paso.eventoId}
                    eventoId={paso.eventoId}
                    onClose={onClose}
                    onGuardado={onClose}
                />
            )}

            <FormularioSorteo
                key={paso.tipo === "formulario" ? `form-${paso.sorteoId || `nuevo-${paso.modalidad}`}` : "form-cerrado"}
                open={paso.tipo === "formulario"}
                sorteoId={paso.tipo === "formulario" ? paso.sorteoId : null}
                // Solo decide en un sorteo NUEVO; al editar manda la modalidad
                // guardada (FormularioSorteo y el backend la conservan).
                instantaneo={paso.tipo === "formulario" && !paso.sorteoId && paso.modalidad === "instantaneo"}
                valorInicial={precio}
                onClose={onClose}
                onGuardado={s => setPaso({ tipo: "vista_previa", sorteoId: s.id })}
            />

            <VistaPreviaModal
                key={paso.tipo === "vista_previa" ? paso.sorteoId : "sin-vista"}
                sorteoId={paso.tipo === "vista_previa" ? paso.sorteoId : null}
                onClose={onClose}
                onConfirmado={onClose}
            />
        </>
    );

}
