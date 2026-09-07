"use client";

import { useEffect, useState } from "react";
import {
    Smartphone,
    ShieldCheck,
    Bell,
    Lock,
    EyeOff,
    KeyRound
} from "lucide-react";

import { getUser } from "@/services/auth/getUser";
import VincularTelefonoModal from "../VincularTelefonoModal/VincularTelefonoModal";

// P1 (backend/pagos, backend/supabase_migrations/005_pagos_p1.sql) ya
// existe: ingesta cruda de movimientos + tabla pagos_dispositivos, pero
// SIN policies para usuarios autenticados y SIN endpoint HTTP de alta de
// dispositivos desde el panel (ver backend/pagos/README.md, "Siguientes
// fases" -> P2). Esta página es únicamente la fase de panel descrita: UI
// explicada + vinculación preparada. A propósito NO hace ningún fetch a
// pagos_dispositivos todavía — no hay ningún endpoint real que consultar
// sin inventarlo.

// URL real del APK, publicada por .github/workflows/android-build.yml
// como asset del Release "apk-latest" (ver android/README.md — sección
// "Descarga desde el panel"). Se lee de una variable de entorno en vez
// de hardcodearse acá: NUNCA una URL inventada ni de localhost, y activar
// la descarga real es cambiar UNA variable, sin tocar código.
// NEXT_PUBLIC_APK_DOWNLOAD_URL vive en frontend/.env.local y hoy está
// vacía a propósito: el workflow todavía no corrió en main, así que ese
// Release (y por lo tanto el APK) todavía no existe.
const APK_URL: string | null = process.env.NEXT_PUBLIC_APK_DOWNLOAD_URL || null;

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

        <div className="space-y-4 sm:space-y-6 max-w-[1800px] mx-auto min-w-0">

            <Cabecera />

            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                <InstalarAplicacion />
                <VincularTelefono email={email} onVincular={() => setModalAbierto(true)} />
            </div>

            <ComoFunciona />

            <Seguridad />

            <MisDispositivos />

            <VincularTelefonoModal
                abierto={modalAbierto}
                emailCuenta={email}
                onCerrar={() => setModalAbierto(false)}
            />

        </div>

    );

}

function Cabecera() {

    return (

        <div className="bg-white border rounded-2xl shadow-sm p-4 sm:p-6 min-w-0">

            <div className="flex items-start gap-3">

                <span className="shrink-0 h-11 w-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl">
                    📱
                </span>

                <div className="min-w-0">
                    <h1 className="font-bold text-gray-900 text-[clamp(1.5rem,5vw,2.25rem)] leading-tight">
                        Lector de pagos
                    </h1>
                    <p className="text-gray-500 mt-1 break-words">
                        Configura tu teléfono para recibir automáticamente los movimientos de pago.
                    </p>
                </div>

            </div>

        </div>

    );

}

function InstalarAplicacion() {

    return (

        <section className="bg-white border rounded-2xl shadow-sm p-4 sm:p-5 flex flex-col min-w-0">

            <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">📲</span>
                <h2 className="text-lg font-bold text-gray-900">Instalar aplicación</h2>
            </div>

            <p className="text-sm text-gray-600 flex-1">
                Instala <b>EFAAT Payments Reader</b> en tu teléfono Android para que EFAAT
                pueda recibir automáticamente los movimientos de pago que lleguen a tus
                notificaciones.
            </p>

            <div className="mt-4">

                {APK_URL ? (
                    <a
                        href={APK_URL}
                        className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                    >
                        📲 Descargar aplicación
                    </a>
                ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <button
                            disabled
                            title="La aplicación todavía no está publicada"
                            className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 bg-gray-100 border border-gray-200 cursor-not-allowed"
                        >
                            📲 Descargar aplicación
                        </button>
                        <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 w-fit">
                            Próximamente
                        </span>
                    </div>
                )}

            </div>

        </section>

    );

}

function VincularTelefono({
    email,
    onVincular
}: {
    email: string | null;
    onVincular: () => void;
}) {

    return (

        <section className="bg-white border rounded-2xl shadow-sm p-4 sm:p-5 flex flex-col min-w-0">

            <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🔗</span>
                <h2 className="text-lg font-bold text-gray-900">Vincular teléfono</h2>
            </div>

            <p className="text-sm text-gray-600 flex-1">
                Conecta tu teléfono con esta cuenta EFAAT{email ? <> (<b>{email}</b>)</> : ""}.
                Una vez instalada la aplicación, usa este botón para vincularla.
            </p>

            <div className="mt-4">
                <button
                    onClick={onVincular}
                    className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                >
                    🔗 Vincular teléfono
                </button>
            </div>

        </section>

    );

}

function ComoFunciona() {

    return (

        <section className="bg-white border rounded-2xl shadow-sm p-4 sm:p-5 min-w-0">

            <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">📖</span>
                <h2 className="text-lg font-bold text-gray-900">¿Cómo funciona?</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">

                {PASOS.map((paso) => (

                    <div
                        key={paso.numero}
                        className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4 flex sm:flex-col items-center sm:text-center gap-3 sm:gap-2"
                    >
                        <span className="shrink-0 h-8 w-8 rounded-full bg-indigo-600 text-white font-bold text-sm flex items-center justify-center">
                            {paso.numero}
                        </span>
                        <p className="text-sm text-gray-700 font-medium">{paso.texto}</p>
                    </div>

                ))}

            </div>

        </section>

    );

}

function Seguridad() {

    return (

        <section className="bg-white border rounded-2xl shadow-sm p-4 sm:p-5 min-w-0">

            <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">🔐</span>
                <h2 className="text-lg font-bold text-gray-900">Seguridad</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                {PUNTOS_SEGURIDAD.map(({ icon: Icon, texto }) => (

                    <div
                        key={texto}
                        className="min-w-0 flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3"
                    >
                        <span className="shrink-0 h-8 w-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                            <Icon size={15} />
                        </span>
                        <p className="text-sm text-gray-700 pt-1">{texto}</p>
                    </div>

                ))}

            </div>

            <div className="flex items-start gap-2 mt-3 text-xs text-gray-400">
                <ShieldCheck size={14} className="shrink-0 mt-0.5" />
                <span>EFAAT nunca solicita ni almacena las contraseñas de tus aplicaciones bancarias.</span>
            </div>

        </section>

    );

}

function MisDispositivos() {

    return (

        <section className="bg-white border rounded-2xl shadow-sm p-4 sm:p-5 min-w-0">

            <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">📱</span>
                <h2 className="text-lg font-bold text-gray-900">Mis dispositivos</h2>
            </div>

            <div className="flex flex-col items-center justify-center text-center py-10 gap-2 text-gray-500">
                <Smartphone size={28} className="text-gray-300" />
                <p className="text-sm">No tienes dispositivos vinculados todavía.</p>
                <p className="text-xs text-gray-400 max-w-xs">
                    Cuando vincules un teléfono, aparecerá aquí con su nombre y la fecha del
                    último movimiento recibido.
                </p>
            </div>

        </section>

    );

}
