"use client";

import "./LoginForm.css";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { register } from "@/services/auth/register";
import { useSesion } from "@/hooks/useSesion";
import { evaluarContrasena, LONGITUD_MINIMA } from "@/lib/auth/seguridadContrasena";
import { CampoContrasena, MedidorSeguridad, AvisoCoincidencia } from "./CampoContrasena";

// Crear cuenta: nombre + correo + contraseña con Supabase Auth. La cuenta
// queda pendiente hasta confirmar el correo; después se inicia sesión en
// /login. Con sesión ya activa, esta pantalla redirige al área privada.
export default function RegisterForm() {

  const router = useRouter();
  const sesion = useSesion();

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmacion, setConfirmacion] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendienteConfirmar, setPendienteConfirmar] = useState(false);

  // Se evalúa en el navegador en cada pulsación; la contraseña no sale de aquí
  // salvo en el registro con Supabase Auth.
  const evaluacion = useMemo(() => evaluarContrasena(password, [nombre, email]), [password, nombre, email]);
  const coinciden = confirmacion ? confirmacion === password : null;

  useEffect(() => {
    if (sesion === "con_sesion") router.replace("/sesiones");
  }, [sesion, router]);

  async function crearCuenta() {

    setError(null);

    if (!nombre.trim() || !email.trim() || !password || !confirmacion) {
      setError("Completa todos los campos.");
      return;
    }

    if (password.length < LONGITUD_MINIMA) {
      setError(`La contraseña debe tener al menos ${LONGITUD_MINIMA} caracteres.`);
      return;
    }

    if (!evaluacion.cumpleMinimo) {
      setError("La contraseña es demasiado fácil de adivinar. Sigue las recomendaciones.");
      return;
    }

    if (password !== confirmacion) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setEnviando(true);

    const { data, error: errorRegistro } = await register(nombre.trim(), email.trim(), password);

    setEnviando(false);

    if (errorRegistro) {
      setError(errorRegistro.message);
      return;
    }

    // Supabase no revela si el correo ya existía: en ese caso devuelve un
    // usuario sin identidades y no envía correo.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setError("Ese correo ya tiene una cuenta. Inicia sesión.");
      return;
    }

    if (data.session) {
      router.replace("/sesiones");
      return;
    }

    setPendienteConfirmar(true);

  }

  if (sesion !== "sin_sesion") return null;

  if (pendienteConfirmar) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1 className="login-title">Revisa tu correo</h1>
          <p className="login-subtitle">
            Te enviamos un enlace a <strong>{email}</strong> para confirmar tu cuenta.
            Después de confirmarla podrás iniciar sesión.
          </p>
          <Link className="login-link" href="/login">iniciar sesión</Link>
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
          crearCuenta();
        }}
      >

        <h1 className="login-title">Crear cuenta</h1>

        <p className="login-subtitle">Regístrate para acceder a EFAAT.</p>

        <input
          className="login-input"
          type="text"
          placeholder="Nombre"
          aria-label="Nombre"
          autoComplete="name"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />

        <input
          className="login-input"
          type="email"
          placeholder="Correo"
          aria-label="Correo"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <CampoContrasena
          etiqueta="Contraseña"
          placeholder={`Contraseña (mínimo ${LONGITUD_MINIMA} caracteres)`}
          autoComplete="new-password"
          value={password}
          onChange={(v) => { setPassword(v); setError(null); }}
          describedBy={password ? "registro-seguridad" : undefined}
          invalido={!!password && !evaluacion.cumpleMinimo}
        />

        {password && <MedidorSeguridad id="registro-seguridad" evaluacion={evaluacion} />}

        <CampoContrasena
          etiqueta="Confirmar contraseña"
          placeholder="Confirmar contraseña"
          autoComplete="new-password"
          value={confirmacion}
          onChange={(v) => { setConfirmacion(v); setError(null); }}
          describedBy="registro-coincide"
          invalido={coinciden === false}
        />

        <AvisoCoincidencia id="registro-coincide" coinciden={coinciden} />

        {error && <p className="login-error" role="alert">{error}</p>}

        <button className="login-button" type="submit" disabled={enviando}>
          {enviando ? "Creando cuenta..." : "Crear cuenta"}
        </button>

        <p className="login-alterno">
          ¿Ya tienes cuenta? <Link className="login-link" href="/login">Inicia sesión</Link>
        </p>

      </form>

    </div>

  );

}
