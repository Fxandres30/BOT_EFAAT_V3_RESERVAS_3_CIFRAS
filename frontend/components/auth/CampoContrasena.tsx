"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, Check, X } from "lucide-react";

import type { EvaluacionContrasena } from "@/lib/auth/seguridadContrasena";

// Campo de contraseña con botón para mostrarla u ocultarla. El botón es
// type="button" para no enviar el formulario y anuncia su estado.
export function CampoContrasena({
  id,
  etiqueta,
  placeholder,
  autoComplete,
  value,
  onChange,
  describedBy,
  invalido = false
}: {
  id?: string;
  etiqueta: string;
  placeholder: string;
  autoComplete: string;
  value: string;
  onChange: (valor: string) => void;
  describedBy?: string;
  invalido?: boolean;
}) {
  const idAuto = useId();
  const idCampo = id ?? idAuto;
  const [visible, setVisible] = useState(false);

  return (
    <div className="login-password">
      <input
        id={idCampo}
        className="login-input"
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        aria-label={etiqueta}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={describedBy}
        aria-invalid={invalido || undefined}
      />
      <button
        type="button"
        className="login-ojo"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? `Ocultar ${etiqueta.toLowerCase()}` : `Mostrar ${etiqueta.toLowerCase()}`}
        aria-pressed={visible}
        aria-controls={idCampo}
      >
        {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
      </button>
    </div>
  );
}

// Barra de 4 segmentos + texto. El número de segmentos llenos también
// transmite el nivel, así que no depende solo del color.
export function MedidorSeguridad({ id, evaluacion }: { id: string; evaluacion: EvaluacionContrasena }) {
  return (
    <div id={id} className={`login-medidor nivel-${evaluacion.nivel}`}>
      <div className="login-medidor-barra" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i <= evaluacion.nivel ? "lleno" : ""} />
        ))}
      </div>
      <p className="login-medidor-texto" aria-live="polite">
        Seguridad: <strong>{evaluacion.etiqueta}</strong>
        <span className="login-medidor-nota"> (orientativo)</span>
      </p>
      <ul className="login-medidor-sugerencias">
        {evaluacion.sugerencias.map((s) => <li key={s}>{s}</li>)}
      </ul>
    </div>
  );
}

// Siempre montado (vacío hasta que se escribe la confirmación) para que el
// lector de pantalla anuncie los cambios de la región aria-live.
export function AvisoCoincidencia({ id, coinciden }: { id: string; coinciden: boolean | null }) {
  return (
    <p id={id} className={`login-coincide ${coinciden === null ? "" : coinciden ? "ok" : "mal"}`} aria-live="polite">
      {coinciden === true && <><Check size={16} aria-hidden="true" /> Las contraseñas coinciden</>}
      {coinciden === false && <><X size={16} aria-hidden="true" /> Las contraseñas no coinciden</>}
    </p>
  );
}
