"use client";

import { useEffect, useMemo, useState } from "react";
import { Puzzle, Plus, Pencil, Copy, Trash2, FlaskConical, Search } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Modal } from "@/components/ui/Modal";
import { Card } from "@/components/ui/Card";

import { getUser } from "@/services/auth/getUser";
import { CATEGORIAS, CategoriaVariable, VariableGlobal, listarCatalogo, normalizarVariableDinamica } from "@/services/mensajes/catalogoVariablesGlobal";
import {
    FilaVariableGlobal,
    DatosVariableGlobal,
    listarVariablesGlobales,
    crearVariableGlobal,
    actualizarVariableGlobal,
    alternarActivaVariableGlobal,
    eliminarVariableGlobal,
    contarUsoEnPlantillas,
    prepararDuplicado,
    probarVariable,
    validarIdentificadorNuevo
} from "@/services/variables/variablesGlobales";

import styles from "./VariablesGlobalesPage.module.css";

type ModoFormulario = "crear" | "editar" | "duplicar";

interface EstadoFormulario {
    modo: ModoFormulario;
    idOriginal: string | null;
    datos: DatosVariableGlobal;
}

function sugerirIdentificador(nombreVisible: string): string {

    return nombreVisible
        .toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "") // quita acentos
        .replace(/[^a-z0-9\s_]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .replace(/^[^a-z]+/, "");

}

function formularioVacio(): EstadoFormulario {

    return {
        modo: "crear",
        idOriginal: null,
        datos: {
            identificador: "",
            nombre_visible: "",
            tipo: "concordancia",
            singular: "",
            plural: "",
            valor: "",
            categoria: "PERSONALIZADA",
            descripcion: "",
            ejemplo: "",
            activa: true
        }
    };

}

export default function VariablesGlobalesPage() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [cargandoUsuario, setCargandoUsuario] = useState(true);

    const [variables, setVariables] = useState<FilaVariableGlobal[]>([]);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [busqueda, setBusqueda] = useState("");

    const [formulario, setFormulario] = useState<EstadoFormulario | null>(null);
    const [errorFormulario, setErrorFormulario] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);

    const [pruebaAbiertaId, setPruebaAbiertaId] = useState<string | null>(null);
    const [cantidadPrueba, setCantidadPrueba] = useState(1);
    const [modificadorPrueba, setModificadorPrueba] = useState<"" | "lower" | "upper" | "capitalize" | "title">("");

    useEffect(() => {

        async function cargarUsuario() {
            const { data } = await getUser();
            setUsuarioId(data.user?.id || null);
            setCargandoUsuario(false);
        }

        cargarUsuario();

    }, []);

    async function cargar(uid: string) {

        setCargando(true);
        setError(null);

        const { data, error: err } = await listarVariablesGlobales(uid);

        if (err) {
            setError(`No se pudo cargar (${err.message}). Verifica que la migración 017 esté aplicada en Supabase.`);
            setVariables([]);
        } else {
            setVariables(data || []);
        }

        setCargando(false);

    }

    useEffect(() => {

        if (!usuarioId) return;

        async function cargarAlMontar() {
            await cargar(usuarioId!);
        }

        cargarAlMontar();

    }, [usuarioId]);

    // CATÁLOGO GLOBAL UNIFICADO = estático (CATALOGO_VARIABLES, siempre
    // presente) + dinámico (filas reales de variables_globales de este
    // usuario). Reutiliza exactamente la misma función que ya usa
    // EditorMensaje.tsx para el autocomplete -- ninguna lista hardcodeada
    // nueva, ninguna regla de precedencia nueva. Si variables_globales está
    // vacía, listarCatalogo() sigue devolviendo el catálogo estático
    // completo (nunca un panel vacío).
    const catalogoExtra = useMemo(() => variables.map(normalizarVariableDinamica), [variables]);
    const catalogoUnificado = useMemo(() => listarCatalogo(catalogoExtra), [catalogoExtra]);

    // Para las entradas dinámicas del catálogo unificado necesitamos volver
    // a la fila real de Supabase (id, activa, usuario_id...) para que las
    // acciones de CRUD (editar/duplicar/eliminar/activar) sigan funcionando
    // exactamente igual que antes -- listarCatalogo() solo devuelve
    // metadata de presentación, nunca la fila completa.
    const filaPorIdentificador = useMemo(() => {
        const mapa = new Map<string, FilaVariableGlobal>();
        for (const fila of variables) mapa.set(fila.identificador, fila);
        return mapa;
    }, [variables]);

    interface ItemCatalogoUnificado {
        definicion: VariableGlobal;
        fila: FilaVariableGlobal | null;
    }

    const itemsUnificados: ItemCatalogoUnificado[] = useMemo(() =>
        catalogoUnificado.map((definicion) => ({
            definicion,
            fila: definicion.dinamica ? (filaPorIdentificador.get(definicion.key) || null) : null
        })),
    [catalogoUnificado, filaPorIdentificador]);

    const itemsFiltrados = useMemo(() => {

        const filtro = busqueda.trim().toLowerCase();

        if (!filtro) return itemsUnificados;

        return itemsUnificados.filter(({ definicion, fila }) =>
            definicion.key.toLowerCase().includes(filtro) ||
            (fila?.nombre_visible || "").toLowerCase().includes(filtro) ||
            definicion.description.toLowerCase().includes(filtro) ||
            definicion.categoria.toLowerCase().includes(filtro) ||
            definicion.aliases.some((alias) => alias.toLowerCase().includes(filtro))
        );

    }, [itemsUnificados, busqueda]);

    function abrirCrear() {
        setErrorFormulario(null);
        setFormulario(formularioVacio());
    }

    function abrirEditar(fila: FilaVariableGlobal) {

        setErrorFormulario(null);
        setFormulario({
            modo: "editar",
            idOriginal: fila.id,
            datos: {
                identificador: fila.identificador,
                nombre_visible: fila.nombre_visible,
                tipo: fila.tipo,
                singular: fila.singular || "",
                plural: fila.plural || "",
                valor: fila.valor || "",
                categoria: fila.categoria,
                descripcion: fila.descripcion || "",
                ejemplo: fila.ejemplo || "",
                activa: fila.activa
            }
        });

    }

    function abrirDuplicar(fila: FilaVariableGlobal) {

        setErrorFormulario(null);
        const datos = prepararDuplicado(fila, variables.map((v) => v.identificador));
        setFormulario({ modo: "duplicar", idOriginal: null, datos });

    }

    async function eliminar(fila: FilaVariableGlobal) {

        if (!usuarioId) return;

        const { count, error: errConteo } = await contarUsoEnPlantillas(usuarioId, fila.identificador);

        if (errConteo) {
            setError(`No se pudo verificar el uso antes de eliminar (${errConteo.message}).`);
            return;
        }

        const mensajeConfirmacion = count > 0
            ? `Esta variable está siendo utilizada por ${count} plantilla${count === 1 ? "" : "s"}. Esas plantillas quedarán con "{{${fila.identificador}}}" sin resolver (vacío) si continúas. ¿Eliminar de todas formas?`
            : `¿Eliminar "{{${fila.identificador}}}"? No está siendo usada por ninguna plantilla.`;

        if (!window.confirm(mensajeConfirmacion)) {
            return;
        }

        const { error: errEliminar } = await eliminarVariableGlobal(fila.id, usuarioId);

        if (errEliminar) {
            setError(`No se pudo eliminar (${errEliminar.message}).`);
            return;
        }

        setVariables((prev) => prev.filter((v) => v.id !== fila.id));

    }

    async function alternarActiva(fila: FilaVariableGlobal) {

        if (!usuarioId) return;

        const { data, error: err } = await alternarActivaVariableGlobal(fila.id, usuarioId, !fila.activa);

        if (!err && data) {
            setVariables((prev) => prev.map((v) => (v.id === fila.id ? (data as FilaVariableGlobal) : v)));
        }

    }

    function actualizarCampoFormulario<K extends keyof DatosVariableGlobal>(campo: K, valor: DatosVariableGlobal[K]) {

        setFormulario((prev) => {

            if (!prev) return prev;

            const datos = { ...prev.datos, [campo]: valor };

            // Auto-sugerir el identificador mientras se escribe el nombre —
            // SOLO al crear/duplicar y SOLO si el admin no lo tocó todavía a
            // mano (heurística simple: coincide con la sugerencia anterior).
            if (campo === "nombre_visible" && prev.modo !== "editar") {

                const sugeridoAnterior = sugerirIdentificador(prev.datos.nombre_visible);

                if (!prev.datos.identificador || prev.datos.identificador === sugeridoAnterior) {
                    datos.identificador = sugerirIdentificador(valor as string);
                }

            }

            return { ...prev, datos };

        });

    }

    async function guardarFormulario() {

        if (!formulario || !usuarioId) return;

        setErrorFormulario(null);

        const { datos, modo, idOriginal } = formulario;

        if (!datos.nombre_visible.trim()) {
            setErrorFormulario("El nombre visible es obligatorio.");
            return;
        }

        if (datos.tipo === "concordancia" && (!datos.singular?.trim() || !datos.plural?.trim())) {
            setErrorFormulario("Para una variable de concordancia, singular y plural son obligatorios.");
            return;
        }

        if (datos.tipo === "texto" && !datos.valor?.trim()) {
            setErrorFormulario("Para una variable de texto, el valor es obligatorio.");
            return;
        }

        setGuardando(true);

        if (modo === "editar" && idOriginal) {

            const { data, error: err } = await actualizarVariableGlobal(idOriginal, usuarioId, {
                nombre_visible: datos.nombre_visible,
                tipo: datos.tipo,
                singular: datos.tipo === "concordancia" ? datos.singular : null,
                plural: datos.tipo === "concordancia" ? datos.plural : null,
                valor: datos.tipo === "texto" ? datos.valor : null,
                categoria: datos.categoria,
                descripcion: datos.descripcion,
                ejemplo: datos.ejemplo,
                activa: datos.activa
            });

            setGuardando(false);

            if (err) {
                setErrorFormulario(err.message);
                return;
            }

            setVariables((prev) => prev.map((v) => (v.id === idOriginal ? (data as FilaVariableGlobal) : v)));
            setFormulario(null);
            return;

        }

        // crear / duplicar -> ambos son un INSERT nuevo con identificador
        // independiente (nunca se sobrescribe la original).
        const errorValidacion = validarIdentificadorNuevo(datos.identificador);

        if (errorValidacion) {
            setGuardando(false);
            setErrorFormulario(errorValidacion.message);
            return;
        }

        const { data, error: err } = await crearVariableGlobal(usuarioId, datos);

        setGuardando(false);

        if (err) {
            setErrorFormulario(err.message);
            return;
        }

        setVariables((prev) => [...prev, data as FilaVariableGlobal]);
        setFormulario(null);

    }

    function alternarPrueba(fila: FilaVariableGlobal) {

        if (pruebaAbiertaId === fila.id) {
            setPruebaAbiertaId(null);
            return;
        }

        setPruebaAbiertaId(fila.id);
        setCantidadPrueba(1);
        setModificadorPrueba("");

    }

    if (cargandoUsuario) {
        return <div className={styles.state}>Cargando…</div>;
    }

    if (!usuarioId) {
        return <div className={styles.state}>Debes iniciar sesión para configurar variables globales.</div>;
    }

    return (
        <div className={styles.page}>

            <PageHeader
                icon={<Puzzle size={20} />}
                title="Variables globales"
                description={`Catálogo global: ${itemsUnificados.length} variables (${itemsUnificados.filter((i) => !i.definicion.dinamica).length} del sistema + ${itemsUnificados.filter((i) => i.definicion.dinamica).length} personalizadas). Las del sistema (evento, cliente, disponible_disponibles, etc.) son de solo lectura — esto solo agrega las que tú necesites.`}
                actions={
                    <Button leftIcon={<Plus size={14} />} onClick={abrirCrear}>
                        Nueva variable
                    </Button>
                }
            />

            <Input
                leftIcon={<Search size={14} />}
                placeholder="Buscar por identificador, nombre, descripción o categoría…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
            />

            {error && <p className={styles.error}>{error}</p>}

            {cargando ? (

                <div className={styles.state}>Cargando…</div>

            ) : itemsFiltrados.length === 0 ? (

                <EmptyState
                    icon={<Puzzle size={22} />}
                    title="Ninguna variable coincide con la búsqueda"
                    description="Prueba con otro término de búsqueda."
                />

            ) : (

                <div className={styles.lista}>

                    {itemsFiltrados.map(({ definicion, fila }) => (

                        <Card
                            key={definicion.key}
                            padding="md"
                            className={fila && !fila.activa ? styles.filaInactiva : undefined}
                        >

                            <div className={styles.filaHeader}>

                                <div>
                                    <span className={styles.chip}>{`{{${definicion.key}}}`}</span>
                                    <strong className={styles.nombre}>{fila ? fila.nombre_visible : definicion.description}</strong>
                                    <span className={styles.categoria}>
                                        {CATEGORIAS[definicion.categoria as CategoriaVariable]?.emoji || "🧩"}{" "}
                                        {CATEGORIAS[definicion.categoria as CategoriaVariable]?.label || definicion.categoria}
                                    </span>
                                </div>

                                {fila ? (
                                    <label className={styles.switchLabel}>
                                        <input
                                            type="checkbox"
                                            checked={fila.activa}
                                            onChange={() => alternarActiva(fila)}
                                        />
                                        {fila.activa ? "Activa" : "Inactiva"}
                                    </label>
                                ) : (
                                    <span className={styles.badgeSistema}>Variable del sistema</span>
                                )}

                            </div>

                            {fila?.descripcion && <p className={styles.descripcion}>{fila.descripcion}</p>}

                            <p className={styles.detalle}>
                                {fila ? (
                                    fila.tipo === "concordancia"
                                        ? <>Singular: <code>{fila.singular}</code> · Plural: <code>{fila.plural}</code></>
                                        : <>Valor: <code>{fila.valor}</code></>
                                ) : (
                                    <>Ejemplo: <code>{definicion.example}</code></>
                                )}
                            </p>

                            {fila ? (

                                <>

                                    <div className={styles.acciones}>
                                        <Button size="sm" variant="secondary" leftIcon={<Pencil size={13} />} onClick={() => abrirEditar(fila)}>Editar</Button>
                                        <Button size="sm" variant="secondary" leftIcon={<Copy size={13} />} onClick={() => abrirDuplicar(fila)}>Duplicar</Button>
                                        <Button size="sm" variant="secondary" leftIcon={<FlaskConical size={13} />} onClick={() => alternarPrueba(fila)}>Probar</Button>
                                        <Button size="sm" variant="danger" leftIcon={<Trash2 size={13} />} onClick={() => eliminar(fila)}>Eliminar</Button>
                                    </div>

                                    {pruebaAbiertaId === fila.id && (

                                        <div className={styles.prueba}>

                                            {fila.tipo === "concordancia" && (
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    label="Cantidad"
                                                    value={cantidadPrueba}
                                                    onChange={(e) => setCantidadPrueba(Number(e.target.value) || 0)}
                                                />
                                            )}

                                            <Select
                                                label="Modificador"
                                                value={modificadorPrueba}
                                                onChange={(e) => setModificadorPrueba(e.target.value as typeof modificadorPrueba)}
                                            >
                                                <option value="">(ninguno)</option>
                                                <option value="lower">lower</option>
                                                <option value="upper">upper</option>
                                                <option value="capitalize">capitalize</option>
                                                <option value="title">title</option>
                                            </Select>

                                            {(() => {

                                                const { resultado, detalle } = probarVariable(fila, cantidadPrueba, modificadorPrueba || undefined);

                                                return (
                                                    <p className={styles.resultadoPrueba}>
                                                        <strong>{resultado || "(vacío)"}</strong>
                                                        <span className={styles.detallePrueba}> — {detalle}</span>
                                                    </p>
                                                );

                                            })()}

                                        </div>

                                    )}

                                </>

                            ) : (

                                <p className={styles.notaSistema}>Variable del sistema — solo lectura, ya funciona en cualquier plantilla.</p>

                            )}

                        </Card>

                    ))}

                </div>

            )}

            <Modal
                open={!!formulario}
                onClose={() => setFormulario(null)}
                title={
                    formulario?.modo === "crear" ? "Nueva variable global" :
                        formulario?.modo === "duplicar" ? "Duplicar variable" : "Editar variable"
                }
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setFormulario(null)}>Cancelar</Button>
                        <Button onClick={guardarFormulario} loading={guardando}>Guardar</Button>
                    </>
                }
            >

                {formulario && (

                    <div className={styles.formulario}>

                        <Input
                            label="Nombre visible"
                            placeholder='Ej: "Suyo / Suyos"'
                            value={formulario.datos.nombre_visible}
                            onChange={(e) => actualizarCampoFormulario("nombre_visible", e.target.value)}
                        />

                        <Input
                            label="Identificador"
                            hint={formulario.modo === "editar" ? "No se puede cambiar (podría romper plantillas que ya lo usan)." : "Solo minúsculas, números y guion bajo. Ej: suyo_suyos"}
                            value={formulario.datos.identificador}
                            disabled={formulario.modo === "editar"}
                            onChange={(e) => actualizarCampoFormulario("identificador", e.target.value.toLowerCase())}
                        />

                        <p className={styles.notaIdentificador}>
                            Variable resultante: <code>{`{{${formulario.datos.identificador || "..."}}}`}</code>
                        </p>

                        <Select
                            label="Tipo de variable"
                            value={formulario.datos.tipo}
                            onChange={(e) => actualizarCampoFormulario("tipo", e.target.value as DatosVariableGlobal["tipo"])}
                        >
                            <option value="concordancia">Concordancia (singular / plural según cantidad)</option>
                            <option value="texto">Texto fijo</option>
                        </Select>

                        {formulario.datos.tipo === "concordancia" ? (

                            <div className={styles.grid2}>
                                <Input
                                    label="Singular"
                                    placeholder="suyo"
                                    value={formulario.datos.singular || ""}
                                    onChange={(e) => actualizarCampoFormulario("singular", e.target.value)}
                                />
                                <Input
                                    label="Plural"
                                    placeholder="suyos"
                                    value={formulario.datos.plural || ""}
                                    onChange={(e) => actualizarCampoFormulario("plural", e.target.value)}
                                />
                            </div>

                        ) : (

                            <Input
                                label="Valor"
                                placeholder="Ej: 3001234567"
                                value={formulario.datos.valor || ""}
                                onChange={(e) => actualizarCampoFormulario("valor", e.target.value)}
                            />

                        )}

                        <Select
                            label="Categoría"
                            value={formulario.datos.categoria || "PERSONALIZADA"}
                            onChange={(e) => actualizarCampoFormulario("categoria", e.target.value)}
                        >
                            {Object.entries(CATEGORIAS).map(([clave, def]) => (
                                <option key={clave} value={clave}>{def.emoji} {def.label}</option>
                            ))}
                        </Select>

                        <Textarea
                            label="Descripción (opcional)"
                            rows={2}
                            value={formulario.datos.descripcion || ""}
                            onChange={(e) => actualizarCampoFormulario("descripcion", e.target.value)}
                        />

                        <Input
                            label="Ejemplo (opcional)"
                            hint="Solo se usa para mostrarlo en el catálogo/autocomplete — nunca se envía como valor real. Si lo dejas vacío, se muestra un ejemplo automático (singular / plural, o el valor fijo)."
                            placeholder={formulario.datos.tipo === "concordancia" ? "Ej: suyo / suyos" : "Ej: 3001234567"}
                            value={formulario.datos.ejemplo || ""}
                            onChange={(e) => actualizarCampoFormulario("ejemplo", e.target.value)}
                        />

                        {errorFormulario && <p className={styles.error}>{errorFormulario}</p>}

                    </div>

                )}

            </Modal>

        </div>
    );

}
