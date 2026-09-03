"use client";

import { use, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

import "./Conectar.css";

export default function Conectar({
  params,
}: {
  params: Promise<{ id: string }>;
}) {

  const { id } = use(params);

  const [qr, setQr] = useState<string | null>(null);
  const [estado, setEstado] = useState("");
  const [segundos, setSegundos] = useState(120);

  function calcularTiempo(expira: string | null) {

    if (!expira) {

      setSegundos(0);

      return;

    }

    const restante = Math.max(

      Math.floor(

        (
          new Date(expira).getTime() -
          Date.now()
        ) / 1000

      ),

      0

    );

    setSegundos(restante);

  }

  function formatearTiempo(total: number) {

    const minutos = Math.floor(total / 60);

    const segundos = total % 60;

    return `${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;

  }

  useEffect(() => {

    async function cargar() {

      const { data } = await supabase

        .from("sesiones")

        .select("qr,estado,nombre,telefono,qr_expira_en")

        .eq("id", id)

        .single();

      if (!data)
        return;

      setQr(data.qr);

      setEstado(data.estado);

      calcularTiempo(data.qr_expira_en);

    }

    cargar();

    const intervalo = setInterval(cargar, 1000);

    const canal = supabase

      .channel(`sesion-${id}`)

      .on(

        "postgres_changes",

        {

          event: "UPDATE",

          schema: "public",

          table: "sesiones",

          filter: `id=eq.${id}`

        },

        (payload: any) => {

          setQr(payload.new.qr);

          setEstado(payload.new.estado);

          calcularTiempo(payload.new.qr_expira_en);

        }

      )

      .subscribe();

    return () => {

      clearInterval(intervalo);

      supabase.removeChannel(canal);

    };

  }, [id]);

  useEffect(() => {

    if (segundos <= 0)
      return;

    const interval = setInterval(() => {

      setSegundos((s) => Math.max(s - 1, 0));

    }, 1000);

    return () => clearInterval(interval);

  }, [segundos]);

  if (estado === "conectado") {

    return (

      <div className="success">

        <div className="success-card">

          <div className="check">

            ✅

          </div>

          <h1>

            WhatsApp conectado

          </h1>

          <p>

            La sesión fue vinculada correctamente.

          </p>

          <p>

            Ya puedes cerrar esta página.

          </p>

        </div>

      </div>

    );

  }

  return (

    <div className="page">

      <div className="card">

        <h1>

          EFAAT BOTS

        </h1>

        <h2>

          Conectar WhatsApp

        </h2>

        <div className="estado">

          <span className="dot"></span>

          Esperando conexión...

        </div>

        <div className="contador">

          ⏳ Expira en <b>{formatearTiempo(segundos)}</b>

        </div>

        {

          qr ?

            <img

              className="qr"

              src={qr}

              alt="QR"

            />

            :

            <div className="loading">

              Generando código QR...

            </div>

        }

        <div className="info">

          <p>

            1. Abre WhatsApp.

          </p>

          <p>

            2. Ve a <b>Dispositivos vinculados</b>.

          </p>

          <p>

            3. Pulsa <b>Vincular un dispositivo</b>.

          </p>

          <p>

            4. Escanea este código QR.

          </p>

        </div>

        <small>

          El código QR se actualiza automáticamente.

        </small>

      </div>

    </div>

  );

}