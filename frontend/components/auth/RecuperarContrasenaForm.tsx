"use client";

import "./LoginForm.css";

import Link from "next/link";
import { useState } from "react";

import { supabase } from "@/lib/supabase";
import { mensajeSolicitud, solicitarRecuperacion } from "@/lib/auth/recuperacion";

// Solicitar el enlace de recuperación. La confirmación es la misma exista o
// no una cuenta con ese correo: la pantalla nunca revela quién está registrado.
export default function RecuperarContrasenaForm() {

  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  async function solicitar() {

    setError(null);
    setEnviando(true);

    const r = await solicitarRecuperacion(supabase.auth, email, window.location.origin);

    setEnviando(false);

    if (!r.ok) {
      setError(mensajeSolicitud(r.motivo));
      return;
    }

    setEnviado(true);

  }

  if (enviado) {
    return (
      <div className="login-container">
        <div className="login-card" role="status">
          <h1 className="login-title">Revisa tu correo</h1>
          <p className="login-subtitle">
            Si hay una cuenta registrada con <strong>{email.trim()}</strong>, te enviamos un enlace para
            crear una contraseña nueva. Puede tardar unos minutos; revisa también la carpeta de spam.
          </p>
          <button className="login-button" type="button" onClick={() => setEnviado(false)}>
            Enviar otro enlace
          </button>
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
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          solicitar();
        }}
      >

        <h1 className="login-title">Recuperar contraseña</h1>

        <p className="login-subtitle">
          Escribe el correo de tu cuenta y te enviaremos un enlace para crear una contraseña nueva.
        </p>

        <input
          className="login-input"
          type="email"
          placeholder="Correo"
          aria-label="Correo"
          autoComplete="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          aria-invalid={!!error || undefined}
        />

        {error && <p className="login-error" role="alert">{error}</p>}

        <button className="login-button" type="submit" disabled={enviando}>
          {enviando ? "Enviando..." : "Enviar enlace"}
        </button>

        <p className="login-alterno">
          ¿La recordaste? <Link className="login-link" href="/login">Inicia sesión</Link>
        </p>

      </form>

    </div>

  );

}
