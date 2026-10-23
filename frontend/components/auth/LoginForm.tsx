"use client";

import "./LoginForm.css";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { login } from "@/services/auth/login";
import { useSesion } from "@/hooks/useSesion";
import { CampoContrasena } from "./CampoContrasena";

// Mensajes de Supabase Auth más comunes, en español.
function mensajeError(mensaje: string) {
  const m = mensaje.toLowerCase();
  if (m.includes("email not confirmed")) return "Confirma tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.";
  if (m.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  return mensaje;
}

export default function LoginForm() {

  const router = useRouter();
  const sesion = useSesion();

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Vuelta desde /restablecer-contrasena tras cambiar la contraseña. Solo se
  // lee en el navegador; el formulario no se pinta hasta conocer la sesión,
  // así que el valor del servidor (false) nunca llega a la pantalla.
  const [claveActualizada] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clave") === "actualizada"
  );

  // Con sesión activa (también al volver del enlace de confirmación de
  // correo) no se muestra el login: se entra directo al área privada.
  useEffect(() => {
    if (sesion === "con_sesion") router.replace("/sesiones");
  }, [sesion, router]);

  async function iniciarSesion() {

    setError(null);

    if (!email || !password) {

      setError("Completa todos los campos.");

      return;

    }

    setLoading(true);

    const { error } = await login(
      email,
      password
    );

    setLoading(false);

    if (error) {

      setError(mensajeError(error.message));

      return;

    }

    router.replace("/sesiones");

  }

  if (sesion !== "sin_sesion") return null;

  return (

    <div className="login-container">

      <form
        className="login-card"
        onSubmit={(e) => {

          e.preventDefault();

          iniciarSesion();

        }}
      >

        <h1 className="login-title">
          EFAAT
        </h1>

        <p className="login-subtitle">
          Inicia sesión para continuar.
        </p>

        <input
          className="login-input"
          type="email"
          placeholder="Correo"
          aria-label="Correo"
          autoComplete="email"
          value={email}
          onChange={(e) =>
            setEmail(e.target.value)
          }
        />

        <CampoContrasena
          etiqueta="Contraseña"
          placeholder="Contraseña"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />

        <p className="login-olvido">
          <Link className="login-link" href="/recuperar-contrasena">¿Olvidaste tu contraseña?</Link>
        </p>

        {claveActualizada && !error && (
          <p className="login-exito" role="status">Tu contraseña se actualizó. Inicia sesión con la nueva.</p>
        )}

        {error && <p className="login-error" role="alert">{error}</p>}

        <button
          className="login-button"
          type="submit"
          disabled={loading}
        >
          {loading ? "Ingresando..." : "Iniciar sesión"}
        </button>

        <p className="login-alterno">
          ¿No tienes cuenta? <Link className="login-link" href="/register">Crear cuenta</Link>
        </p>

      </form>

    </div>

  );

}
