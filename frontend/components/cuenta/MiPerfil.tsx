"use client";

import "@/components/auth/LoginForm.css";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, UserRound } from "lucide-react";

import { Badge, Button, Card, Input, SectionHeader } from "@/components/ui";
import { CampoContrasena, MedidorSeguridad, AvisoCoincidencia } from "@/components/auth/CampoContrasena";
import { supabase } from "@/lib/supabase";
import { evaluarContrasena, LONGITUD_MINIMA } from "@/lib/auth/seguridadContrasena";
import { validarNuevaContrasena } from "@/lib/auth/recuperacion";
import {
    actualizarNombre,
    cambiarContrasena,
    formatearFecha,
    LONGITUD_MAXIMA_NOMBRE
} from "@/lib/cuenta/cuenta";
import { CORREO_COMERCIAL } from "@/lib/comercial/planes";
import usePerfilCuenta from "@/hooks/usePerfilCuenta";

import CuentaHeader from "./CuentaNav";
import styles from "./Cuenta.module.css";

type Aviso = { tipo: "ok" | "error"; texto: string } | null;

function Mensaje({ aviso }: { aviso: Aviso }) {
    if (!aviso) return null;
    return (
        <p className={aviso.tipo === "ok" ? styles.ok : styles.error} role={aviso.tipo === "error" ? "alert" : "status"}>
            {aviso.tipo === "ok" ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertCircle size={15} aria-hidden="true" />}
            {aviso.texto}
        </p>
    );
}

export default function MiPerfil() {

    const { perfil, cargando, recargar } = usePerfilCuenta();

    // null = sin editar: se muestra el nombre guardado.
    const [nombreEditado, setNombreEditado] = useState<string | null>(null);
    const nombre = nombreEditado ?? perfil?.nombre ?? "";
    const [guardandoNombre, setGuardandoNombre] = useState(false);
    const [avisoNombre, setAvisoNombre] = useState<Aviso>(null);

    const [actual, setActual] = useState("");
    const [nueva, setNueva] = useState("");
    const [confirmacion, setConfirmacion] = useState("");
    const [guardandoClave, setGuardandoClave] = useState(false);
    const [avisoClave, setAvisoClave] = useState<Aviso>(null);

    const correo = perfil?.correo || null;
    const evaluacion = useMemo(() => evaluarContrasena(nueva, correo ? [correo] : []), [nueva, correo]);
    const coinciden = confirmacion ? confirmacion === nueva : null;

    async function guardarNombre(e: React.FormEvent) {
        e.preventDefault();
        setAvisoNombre(null);
        setGuardandoNombre(true);
        const r = await actualizarNombre(supabase.auth, nombre);
        setGuardandoNombre(false);
        if (!r.ok) {
            setAvisoNombre({ tipo: "error", texto: r.error });
            return;
        }
        setAvisoNombre({ tipo: "ok", texto: "Nombre actualizado." });
        await recargar();
        setNombreEditado(null);
    }

    async function guardarClave(e: React.FormEvent) {
        e.preventDefault();
        setAvisoClave(null);

        const invalida = validarNuevaContrasena(nueva, confirmacion, evaluacion.cumpleMinimo, LONGITUD_MINIMA);
        if (invalida) {
            setAvisoClave({ tipo: "error", texto: invalida });
            return;
        }

        setGuardandoClave(true);
        const r = await cambiarContrasena(supabase.auth, actual, nueva);
        setGuardandoClave(false);

        if (!r.ok) {
            setAvisoClave({ tipo: "error", texto: r.error });
            return;
        }

        setActual("");
        setNueva("");
        setConfirmacion("");
        setAvisoClave({ tipo: "ok", texto: "Contraseña actualizada. Úsala la próxima vez que inicies sesión." });
    }

    const sinDato = <span className={styles.sinDato}>No registrado</span>;

    return (

        <div className={styles.page}>

            <CuentaHeader />

            {cargando ? (
                <div className={styles.state}>Cargando tu cuenta…</div>
            ) : !perfil ? (
                <div className={styles.state}>Tu sesión terminó. Inicia sesión de nuevo.</div>
            ) : (

                <div className={styles.stack}>

                    <Card padding="lg">

                        <SectionHeader title="Datos de la cuenta" icon={<UserRound size={16} />} />

                        <dl className={styles.datos}>
                            <dt>Nombre</dt>
                            <dd>{perfil.nombre || sinDato}</dd>

                            <dt>Correo</dt>
                            <dd>
                                {perfil.correo || sinDato}{" "}
                                <Badge tone={perfil.correoConfirmado ? "success" : "warning"} size="sm">
                                    {perfil.correoConfirmado ? "Confirmado" : "Sin confirmar"}
                                </Badge>
                            </dd>

                            <dt>Cuenta creada</dt>
                            <dd>{formatearFecha(perfil.creadaEn) || sinDato}</dd>

                            <dt>Último inicio de sesión</dt>
                            <dd>{formatearFecha(perfil.ultimoAcceso) || sinDato}</dd>
                        </dl>

                        <p className={styles.nota} style={{ marginTop: 16 }}>
                            El correo es tu usuario de acceso y no se puede cambiar desde el panel. Si necesitas
                            cambiarlo, escríbenos a {CORREO_COMERCIAL}.
                        </p>

                    </Card>

                    <Card padding="lg">

                        <SectionHeader title="Nombre visible" description="Cómo te saludamos en el panel." />

                        <Mensaje aviso={avisoNombre} />

                        <form className={styles.form} onSubmit={guardarNombre}>
                            <Input
                                label="Nombre"
                                value={nombre}
                                maxLength={LONGITUD_MAXIMA_NOMBRE}
                                autoComplete="name"
                                onChange={(e) => setNombreEditado(e.target.value)}
                            />
                            <div className={styles.acciones}>
                                <Button
                                    type="submit"
                                    loading={guardandoNombre}
                                    disabled={nombre.trim() === (perfil.nombre || "")}
                                >
                                    Guardar nombre
                                </Button>
                            </div>
                        </form>

                    </Card>

                    <Card padding="lg">

                        <SectionHeader
                            title="Cambiar contraseña"
                            description="Por seguridad te pedimos primero tu contraseña actual."
                            icon={<KeyRound size={16} />}
                        />

                        <Mensaje aviso={avisoClave} />

                        <form className={styles.form} onSubmit={guardarClave}>

                            <div>
                                <label className={styles.etiqueta} htmlFor="clave-actual">Contraseña actual</label>
                                <CampoContrasena
                                    id="clave-actual"
                                    etiqueta="Contraseña actual"
                                    placeholder="Tu contraseña actual"
                                    autoComplete="current-password"
                                    value={actual}
                                    onChange={setActual}
                                />
                            </div>

                            <div>
                                <label className={styles.etiqueta} htmlFor="clave-nueva">Nueva contraseña</label>
                                <CampoContrasena
                                    id="clave-nueva"
                                    etiqueta="Nueva contraseña"
                                    placeholder={`Mínimo ${LONGITUD_MINIMA} caracteres`}
                                    autoComplete="new-password"
                                    value={nueva}
                                    onChange={setNueva}
                                    describedBy="medidor-cuenta"
                                />
                                {nueva && <MedidorSeguridad id="medidor-cuenta" evaluacion={evaluacion} />}
                            </div>

                            <div>
                                <label className={styles.etiqueta} htmlFor="clave-confirmacion">Confirmar nueva contraseña</label>
                                <CampoContrasena
                                    id="clave-confirmacion"
                                    etiqueta="Confirmar nueva contraseña"
                                    placeholder="Repite la nueva contraseña"
                                    autoComplete="new-password"
                                    value={confirmacion}
                                    onChange={setConfirmacion}
                                    describedBy="coincide-cuenta"
                                    invalido={coinciden === false}
                                />
                                <AvisoCoincidencia id="coincide-cuenta" coinciden={coinciden} />
                            </div>

                            <div className={styles.acciones}>
                                <Button type="submit" loading={guardandoClave} disabled={!actual || !nueva || !confirmacion}>
                                    Cambiar contraseña
                                </Button>
                            </div>

                        </form>

                    </Card>

                </div>

            )}

        </div>

    );

}
