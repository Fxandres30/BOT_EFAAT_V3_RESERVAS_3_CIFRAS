"use client";

import { BookOpen, LifeBuoy, Mail } from "lucide-react";

import { Card, SectionHeader } from "@/components/ui";
import { CORREO_COMERCIAL, enlaceSoporte } from "@/lib/comercial/planes";
import usePerfilCuenta from "@/hooks/usePerfilCuenta";

import CuentaHeader from "./CuentaNav";
import styles from "./Cuenta.module.css";

// Único canal de contacto existente: el correo de soporte (el mismo de la
// landing). Las preguntas frecuentes son las de la página principal.
export default function AyudaSoporte() {

    const { perfil } = usePerfilCuenta();

    return (

        <div className={styles.page}>

            <CuentaHeader />

            <div className={styles.stack}>

                <Card padding="lg">

                    <SectionHeader
                        title="Escríbenos"
                        description="Cuéntanos qué pasa e incluye, si puedes, el grupo o la sesión afectados."
                        icon={<LifeBuoy size={16} />}
                    />

                    <dl className={styles.datos}>
                        <dt>Correo de soporte</dt>
                        <dd>
                            <a className={styles.enlace} href={enlaceSoporte("soporte", perfil?.correo || null)}>
                                <Mail size={14} aria-hidden="true" />
                                {CORREO_COMERCIAL}
                            </a>
                        </dd>
                    </dl>

                    <p className={styles.nota} style={{ marginTop: 12 }}>
                        Nunca te pediremos tu contraseña ni el código de vinculación de WhatsApp.
                    </p>

                </Card>

                <Card padding="lg">

                    <SectionHeader title="Recursos" icon={<BookOpen size={16} />} />

                    <ul className={styles.lista}>
                        <li className={styles.fila}>
                            <a className={styles.enlace} href="/#preguntas" target="_blank" rel="noopener">Preguntas frecuentes</a>
                        </li>
                        <li className={styles.fila}>
                            <a className={styles.enlace} href="/#conectar-whatsapp" target="_blank" rel="noopener">Recomendaciones para conectar WhatsApp</a>
                        </li>
                    </ul>

                </Card>

            </div>

        </div>

    );

}
