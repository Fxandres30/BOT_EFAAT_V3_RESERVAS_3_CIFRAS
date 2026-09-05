require("dotenv").config();

console.log("URL:", process.env.SUPABASE_URL);
console.log("KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0,20));

const express = require("express");
const cors = require("cors");

const sessionsRoutes = require("./routes/sessions");

const supabase = require("./lib/supabase");

const manager =
require("./services/baileys/manager");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/sessions", sessionsRoutes);

app.listen(4000, async () => {

    console.log("================================");
    console.log(" BOT API");
    console.log(" http://localhost:4000");
    console.log("================================");

    // Registra el listener central de cambio de sesión (Fase 5.1) ANTES
    // de restaurar sesiones, para no perder el primer "activeChanged".
    require("./bot")();

    await restaurarSesiones();

});

async function restaurarSesiones() {

    const { data, error } = await supabase
        .from("sesiones")
        .select("id, estado, activa");

    if (error) {

        console.log(error);

        return;

    }

    const sesiones = data.filter(

        s => s.estado === "conectado"

    );

    console.log(

        `Restaurando ${sesiones.length} sesiones...`

    );

    for (const sesion of sesiones) {

        try {

            const resultado = await manager.start(

                sesion.id

            );

            // La sesión sigue "conectado" en Supabase pero el lease
            // distribuido (LOCAL/VPS) pertenece a la OTRA instancia — NO es
            // una desconexión: puede estar funcionando correctamente ahí.
            // No se toca su estado en Supabase ni se reintenta aquí.
            if (resultado === manager.LEASE_NO_DISPONIBLE) {

                console.log(

                    "⏳ [LEASE] sigue conectada en otra instancia, no se restaura aquí:",

                    sesion.id

                );

            } else {

                console.log(

                    "✅ Restaurada:",

                    sesion.id

                );

            }

        }

        catch (err) {

            console.log(

                "❌",

                sesion.id,

                err.message

            );

        }

    }

    // Restaurar la sesión activa guardada en la BD
    const activa = data.find(

        s => s.activa === true

    );

    if (activa) {

        const ok = manager.setActive(

            activa.id

        );

        if (!ok) {

            console.log(
                "⚠️ La sesión marcada como activa no está conectada."
            );

        }

    }

}