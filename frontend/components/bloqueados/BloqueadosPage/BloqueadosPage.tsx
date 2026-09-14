"use client";

import { useEffect, useState } from "react";
import { ShieldBan, Plus, Search } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

import { getUser } from "@/services/auth/getUser";
import { listarBloqueados, FilaBloqueado } from "@/services/bloqueados/bloqueados";

import styles from "./BloqueadosPage.module.css";

// ==========================================================================
// Sección "Bloqueados" — SOLO estructura preparada para el futuro.
//
// Esta fase NO implementa ninguna acción real: el botón "Agregar bloqueo"
// está deshabilitado a propósito (no basta con "no abrir un formulario" --
// debe ser estructuralmente imposible crear un registro por accidente en
// esta fase, incluso si alguien lo intenta hacer clic). No hay ninguna
// conexión con WhatsApp, ningún middleware de bloqueo, ninguna expulsión
// ni impedimento de mensajes, ningún trigger/listener/scheduler. La
// condición obligatoria de esta fase es que la tabla "bloqueados" empiece
// y termine en 0 filas.
// ==========================================================================

const ETIQUETA_TIPO: Record<FilaBloqueado["tipo"], string> = {
    telefono: "Teléfono",
    jid: "JID",
    lid: "LID"
};

export default function BloqueadosPage() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [cargandoUsuario, setCargandoUsuario] = useState(true);

    const [bloqueados, setBloqueados] = useState<FilaBloqueado[]>([]);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [busqueda, setBusqueda] = useState("");

    useEffect(() => {

        async function cargarUsuario() {
            const { data } = await getUser();
            setUsuarioId(data.user?.id || null);
            setCargandoUsuario(false);
        }

        cargarUsuario();

    }, []);

    useEffect(() => {

        if (!usuarioId) return;

        async function cargar() {

            setCargando(true);

            const { data, error: err } = await listarBloqueados(usuarioId!);

            if (err) {
                // Tabla todavía no creada (migración 017 pendiente) u otro
                // error de lectura -- se trata igual que "sin bloqueados",
                // nunca se inventa un dato ni se rompe la pantalla.
                setError(`No se pudo consultar Supabase (${err.message}). Probablemente la migración 017 todavía no está aplicada.`);
                setBloqueados([]);
            } else {
                setBloqueados(data || []);
            }

            setCargando(false);

        }

        cargar();

    }, [usuarioId]);

    const filtrados = bloqueados.filter((b) =>
        !busqueda.trim() || b.identificador.toLowerCase().includes(busqueda.trim().toLowerCase())
    );

    if (cargandoUsuario) {
        return <div className={styles.state}>Cargando…</div>;
    }

    return (
        <div className={styles.page}>

            <PageHeader
                icon={<ShieldBan size={20} />}
                title="🚫 Bloqueados"
                description="Teléfonos, JID o LID bloqueados globalmente. Estructura preparada para el futuro — todavía no ejecuta ninguna acción sobre WhatsApp ni sobre los grupos."
                actions={
                    <Button
                        leftIcon={<Plus size={14} />}
                        disabled
                        title="Próximamente — esta fase solo prepara la estructura, todavía no permite crear bloqueos"
                    >
                        Agregar bloqueo (Próximamente)
                    </Button>
                }
            />

            <div className={styles.resumen}>

                <span className={styles.contador}>
                    <strong>{bloqueados.length}</strong> bloqueado{bloqueados.length === 1 ? "" : "s"}
                </span>

                <span className={styles.tiposLeyenda}>
                    Tipos soportados: <span className={styles.tipoBadge}>Teléfono</span> <span className={styles.tipoBadge}>JID</span> <span className={styles.tipoBadge}>LID</span>
                </span>

            </div>

            <Input
                leftIcon={<Search size={14} />}
                placeholder="Buscar por identificador…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
            />

            {error && <p className={styles.avisoTecnico}>{error}</p>}

            {cargando ? (

                <div className={styles.state}>Cargando…</div>

            ) : filtrados.length === 0 ? (

                <EmptyState
                    icon={<ShieldBan size={22} />}
                    title="🚫 No hay bloqueados"
                    description={
                        bloqueados.length === 0
                            ? "Todavía no tienes ningún teléfono, JID o LID registrado como bloqueado."
                            : "Ningún bloqueado coincide con la búsqueda."
                    }
                />

            ) : (

                // No debería llegar a renderizarse en esta fase (0 registros
                // garantizado) — se deja preparado para cuando exista la
                // lógica real de creación, en vez de descartar los datos.
                <ul className={styles.lista}>
                    {filtrados.map((b) => (
                        <li key={b.id} className={styles.item}>
                            <span className={styles.tipo}>{ETIQUETA_TIPO[b.tipo]}</span> {b.identificador}
                            {b.motivo ? ` — ${b.motivo}` : ""}
                        </li>
                    ))}
                </ul>

            )}

        </div>
    );

}
