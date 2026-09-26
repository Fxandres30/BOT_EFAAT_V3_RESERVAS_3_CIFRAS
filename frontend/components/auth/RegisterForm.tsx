"use client";

import "./LoginForm.css";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { register } from "@/services/auth/register";
import { useSesion } from "@/hooks/useSesion";

// Crear cuenta: nombre + correo + contraseña con Supabase Auth. La cuenta
// queda pendiente hasta confirmar el correo; después se inicia sesión en
// /login. Con sesión ya activa, esta pantalla redirige al área privada.
export default function RegisterForm() {

  const router = useRouter();
  const sesion = useSesion();

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendienteConfirmar, setPendienteConfirmar] = useState(false);

  useEffect(() => {
    if (sesion === "con_sesion") router.replace("/sesiones");
  }, [sesion, router]);

  async function crearCuenta() {

    setError(null);

    if (!nombre.trim() || !email.trim() || !password) {
      setError("Completa todos los campos.");
      return;
    }

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
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
          <Link className="login-link" href="/login">Ir a iniciar sesión</Link>
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

        <p className="login-subtitle">Regístrate para acceder a EFAAT BOTS.</p>

        <input
          className="login-input"
          type="text"
          placeholder="Nombre"
          autoComplete="name"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />

        <input
          className="login-input"
          type="email"
          placeholder="Correo"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="login-input"
          type="password"
          placeholder="Contraseña (mínimo 6 caracteres)"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

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
