"use client";

import { useState } from "react";

export default function RegisterForm() {

  const [name, setName] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  function register() {

    console.log(name);

    console.log(email);

    console.log(password);

  }

  return (

    <div>

      <h1>Crear cuenta</h1>

      <input
        placeholder="Nombre"
        value={name}
        onChange={(e) =>
          setName(e.target.value)
        }
      />

      <input
        placeholder="Correo"
        value={email}
        onChange={(e) =>
          setEmail(e.target.value)
        }
      />

      <input
        type="password"
        placeholder="Contraseña"
        value={password}
        onChange={(e) =>
          setPassword(e.target.value)
        }
      />

      <button onClick={register}>
        Registrarme
      </button>

    </div>

  );

}