"use client";

import { useEffect, useState } from "react";
import {
    Smartphone,
    ShieldCheck,
    Bell,
    Lock,
    EyeOff,
    KeyRound,
    Download,
    Link2,
    BookOpen,
} from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

import { getUser } from "@/services/auth/getUser";
import VincularTelefonoModal from "../VincularTelefonoModal/VincularTelefonoModal";

import styles from "./LectorPagosPage.module.css";

// Ver comentarios del backend (backend/pagos/README.md, P2): esta pantalla
// es solo la fase de panel — explica el flujo y prepara la vinculación. NO
// hace ningún fetch a pagos_dispositivos (no hay endpoint real todavía),
// así que no muestra estado del lector ni lista de pagos: esos datos aún
// no existen.

const APK_URL_LOCAL = "/downloads/EFAAT-Payments-Reader.apk";

const APK_URL: string | null = process.env.NEXT_PUBLIC_APK_DOWNLOAD_URL || APK_URL_LOCAL;

const PASOS = [
    { numero: 1, texto: "Descarga la aplicación" },
    { numero: 2, texto: "Instálala en Android" },
    { numero: 3, texto: "Permite acceso a notificaciones" },
    { numero: 4, texto: "Vincula el teléfono" },
    { numero: 5, texto: "EFAAT recibe los movimientos" }
];

const PUNTOS_SEGURIDAD = [
    { icon: Bell, texto: "La app solamente lee las notificaciones autorizadas." },
    { icon: KeyRound, texto: "No obtiene contraseñas bancarias." },
    { icon: Lock, texto: "No inicia sesión en las apps bancarias." },
    { icon: EyeOff, texto: "Las credenciales del dispositivo no se muestran." }
];

export default function LectorPagosPage() {

    const [email, setEmail] = useState<string | null>(null);
    const [modalAbierto, setModalAbierto] = useState(false);

    useEffect(() => {

        let vivo = true;

        async function cargar() {
            const { data } = await getUser();
            if (vivo) setEmail(data.user?.email || null);
        }

        cargar();

        return () => { vivo = false; };

    }, []);

    return (

        <div className={styles.page}>

            <PageHeader
                title="Lector de pagos"
                description="Configura un teléfono Android para que EFAAT reciba automáticamente los movimientos de pago desde sus notificaciones."
            />

            <div className={styles.grid2}>

                <Card padding="md">
                    <div className={styles.panel}>
                        <h2 className={styles.panelTitle}>
                            <Smartphone size={15} /> Instalar aplicación
                        </h2>
                        <p className={styles.panelText}>
                            Instala <b>EFAAT Payments Reader</b> en tu teléfono Android para que
                            EFAAT reciba los movimientos de pago que lleguen a tus notificaciones.
                        </p>
                        <div className={styles.actions}>
                            {APK_URL ? (
                                <a href={APK_URL} className={styles.downloadBtn}>
                                    <Download size={15} /> Descargar aplicación
                                </a>
                            ) : (
                                <>
                                    <span
                                        className={`${styles.downloadBtn} ${styles.downloadBtnDisabled}`}
                                        title="La aplicación todavía no está publicada"
                                    >
                                        <Download size={15} /> Descargar aplicación
                                    </span>
                                    <Badge tone="warning">Próximamente</Badge>
                                </>
                            )}
                        </div>
                    </div>
                </Card>

                <Card padding="md">
                    <div className={styles.panel}>
                        <h2 className={styles.panelTitle}>
                            <Link2 size={15} /> Vincular teléfono
                        </h2>
                        <p className={styles.panelText}>
                            Conecta tu teléfono con esta cuenta EFAAT
                            {email ? <> (<b>{email}</b>)</> : ""}. Una vez instalada la app, usa
                            este botón para vincularla.
                        </p>
                        <div className={styles.actions}>
                            <Button
                                size="sm"
                                leftIcon={<Link2 size={14} />}
                                onClick={() => setModalAbierto(true)}
                            >
                                Vincular teléfono
                            </Button>
                        </div>
                    </div>
                </Card>

            </div>

            <Card padding="md">
                <div className={styles.panel}>
                    <h2 className={styles.panelTitle}>
                        <BookOpen size={15} /> ¿Cómo funciona?
                    </h2>
                    <div className={styles.steps}>
                        {PASOS.map((paso) => (
                            <div key={paso.numero} className={styles.step}>
                                <span className={styles.stepNum}>{paso.numero}</span>
                                <span className={styles.stepText}>{paso.texto}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </Card>

            <Card padding="md">
                <div className={styles.panel}>
                    <h2 className={styles.panelTitle}>
                        <ShieldCheck size={15} /> Seguridad
                    </h2>
                    <div className={styles.secGrid}>
                        {PUNTOS_SEGURIDAD.map(({ icon: Icon, texto }) => (
                            <div key={texto} className={styles.secItem}>
                                <Icon size={14} />
                                <span>{texto}</span>
                            </div>
                        ))}
                    </div>
                    <p className={styles.disclaimer}>
                        <ShieldCheck size={13} />
                        EFAAT nunca solicita ni almacena las contraseñas de tus aplicaciones bancarias.
                    </p>
                </div>
            </Card>

            <Card padding="md">
                <div className={styles.panel}>
                    <h2 className={styles.panelTitle}>
                        <Smartphone size={15} /> Mis dispositivos
                    </h2>
                    <EmptyState
                        bare
                        icon={<Smartphone size={20} />}
                        title="Sin dispositivos vinculados"
                        description="Cuando vincules un teléfono aparecerá aquí con su nombre y la fecha del último movimiento recibido."
                    />
                </div>
            </Card>

            <VincularTelefonoModal
                abierto={modalAbierto}
                emailCuenta={email}
                onCerrar={() => setModalAbierto(false)}
            />

        </div>

    );

}
