"use client";

import "./LoginForm.css";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { login } from "@/services/auth/login";
import { useSesion } from "@/hooks/useSesion";

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
          EFAAT BOTS
        </h1>

        <p className="login-subtitle">
          Inicia sesión para continuar.
        </p>

        <input
          className="login-input"
          type="email"
          placeholder="Correo"
          autoComplete="email"
          value={email}
          onChange={(e) =>
            setEmail(e.target.value)
          }
        />

        <input
          className="login-input"
          type="password"
          placeholder="Contraseña"
          autoComplete="current-password"
          value={password}
          onChange={(e) =>
            setPassword(e.target.value)
          }
        />

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
