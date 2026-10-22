"use client";

import "./LoginForm.css";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";
import { logout } from "@/services/auth/logout";
import { evaluarContrasena, LONGITUD_MINIMA } from "@/lib/auth/seguridadContrasena";
import {
  RUTA_SOLICITAR,
  actualizarContrasena,
  leerEnlaceRecuperacion,
  mensajeEnlace,
  urlSinDatosDeEnlace,
  validarNuevaContrasena,
  verificarEnlace,
  type MotivoEnlace,
  type ResultadoVerificacion
} from "@/lib/auth/recuperacion";
import { CampoContrasena, MedidorSeguridad, AvisoCoincidencia } from "./CampoContrasena";

// El enlace se lee al CARGAR el módulo: supabase-js borra el hash con los
// tokens en cuanto crea la sesión, y aquí hace falta saber qué traía.
const ENLACE_INICIAL = typeof window !== "undefined" ? leerEnlaceRecuperacion(window.location.href) : null;

// Una sola verificación por carga de página: en desarrollo React ejecuta los
// efectos dos veces, y un verifyOtp repetido gastaría el enlace.
let verificacion: Promise<ResultadoVerificacion> | null = null;

function verificarUnaVez() {
  if (!verificacion) {
    verificacion = verificarEnlace(supabase.auth, ENLACE_INICIAL ?? leerEnlaceRecuperacion(window.location.href)).then((r) => {
      // Ya procesado por supabase-js: fuera tokens y códigos de la URL.
      window.history.replaceState(window.history.state, "", urlSinDatosDeEnlace(window.location.href));
      return r;
    });
  }
  return verificacion;
}

type Estado =
  | { fase: "verificando" }
  | { fase: "invalido"; motivo: MotivoEnlace }
  | { fase: "formulario"; correo: string | null };

export default function RestablecerContrasenaForm() {

  const [estado, setEstado] = useState<Estado>({ fase: "verificando" });
  const [password, setPassword] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const correo = estado.fase === "formulario" ? estado.correo : null;
  const evaluacion = useMemo(() => evaluarContrasena(password, correo ? [correo] : []), [password, correo]);
  const coinciden = confirmacion ? confirmacion === password : null;

  useEffect(() => {
    let vigente = true;
    verificarUnaVez().then((r) => {
      if (!vigente) return;
      setEstado(r.ok ? { fase: "formulario", correo: r.correo } : { fase: "invalido", motivo: r.motivo });
    });
    return () => { vigente = false; };
  }, []);

  async function guardar() {

    setError(null);

    const invalida = validarNuevaContrasena(password, confirmacion, evaluacion.cumpleMinimo, LONGITUD_MINIMA);
    if (invalida) {
      setError(invalida);
      return;
    }

    setGuardando(true);

    const r = await actualizarContrasena(supabase.auth, password);

    if (!r.ok) {
      setGuardando(false);
      if (r.motivo === "enlace") setEstado({ fase: "invalido", motivo: "caducado" });
      else setError(r.mensaje);
      return;
    }

    // La sesión de recuperación se cierra (igual que «Cerrar sesión»): se entra
    // de nuevo con la contraseña nueva y las reglas de sesión de siempre. Carga
    // completa del login: no queda nada de la recuperación en memoria.
    await logout();
    window.location.replace("/login?clave=actualizada");

  }

  if (estado.fase === "verificando") {
    return (
      <div className="login-container">
        <div className="login-card" role="status" aria-live="polite">
          <h1 className="login-title">Nueva contraseña</h1>
          <p className="login-subtitle">Comprobando el enlace…</p>
        </div>
      </div>
    );
  }

  if (estado.fase === "invalido") {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1 className="login-title">Enlace no válido</h1>
          <p className="login-error" role="alert">{mensajeEnlace(estado.motivo)}</p>
          {estado.motivo === "red" ? (
            <button className="login-button" type="button" onClick={() => window.location.reload()}>
              Reintentar
            </button>
          ) : (
            <Link className="login-button login-button-enlace" href={RUTA_SOLICITAR}>
              Solicitar un enlace nuevo
            </Link>
          )}
          <p className="login-alterno">
            <Link className="login-link" href="/login">Volver a iniciar sesión</Link>
          </p>
        </div>
      </div>
    );
  }

  return (

    <div className="login-container">

      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          guardar();
        }}
      >

        <h1 className="login-title">Nueva contraseña</h1>

        <p className="login-subtitle">
          {correo ? <>Crea una contraseña nueva para <strong>{correo}</strong>.</> : "Crea una contraseña nueva para tu cuenta."}
        </p>

        <CampoContrasena
          etiqueta="Nueva contraseña"
          placeholder={`Nueva contraseña (mínimo ${LONGITUD_MINIMA} caracteres)`}
          autoComplete="new-password"
          value={password}
          onChange={(v) => { setPassword(v); setError(null); }}
          describedBy={password ? "restablecer-seguridad" : undefined}
          invalido={!!password && !evaluacion.cumpleMinimo}
        />

        {password && <MedidorSeguridad id="restablecer-seguridad" evaluacion={evaluacion} />}

        <CampoContrasena
          etiqueta="Confirmar contraseña"
          placeholder="Confirmar contraseña"
          autoComplete="new-password"
          value={confirmacion}
          onChange={(v) => { setConfirmacion(v); setError(null); }}
          describedBy="restablecer-coincide"
          invalido={coinciden === false}
        />

        <AvisoCoincidencia id="restablecer-coincide" coinciden={coinciden} />

        {error && <p className="login-error" role="alert">{error}</p>}

        <button className="login-button" type="submit" disabled={guardando}>
          {guardando ? "Guardando..." : "Guardar contraseña"}
        </button>

      </form>

    </div>

  );

}
