"use client";

import "./LoginForm.css";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { login } from "@/services/auth/login";

export default function LoginForm() {

  const router = useRouter();

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);

  async function iniciarSesion() {

    if (!email || !password) {

      alert("Completa todos los campos.");

      return;

    }

    setLoading(true);

    const { error } = await login(
      email,
      password
    );

    setLoading(false);

    if (error) {

      alert(error.message);

      return;

    }

    router.replace("/sesiones");

  }

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
          value={email}
          onChange={(e) =>
            setEmail(e.target.value)
          }
        />

        <input
          className="login-input"
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) =>
            setPassword(e.target.value)
          }
        />

        <button
          className="login-button"
          type="submit"
          disabled={loading}
        >
          {loading ? "Ingresando..." : "Iniciar sesión"}
        </button>

      </form>

    </div>

  );

}