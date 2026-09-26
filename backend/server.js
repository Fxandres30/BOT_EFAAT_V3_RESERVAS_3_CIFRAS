require("dotenv").config();

const express = require("express");
const cors = require("cors");

const sessionsRoutes = require("./routes/sessions");
const pagosRoutes = require("./routes/pagos");
const tablasRoutes = require("./routes/tablas");
const contactosRoutes = require("./routes/contactos");
const bloqueadosRoutes = require("./routes/bloqueados");
const analiticaRoutes = require("./routes/analitica");

// Token compartido servidor-a-servidor para /sessions/* (BANN apps/api y
// las rutas proxy del panel Next). Ver middleware/tokenServicio.js.
const { exigirTokenServicio } = require("./middleware/tokenServicio");

const supabase = require("./lib/supabase");

const manager =
require("./services/baileys/manager");

const app = express();

app.use(cors());

// Antes del express.json() global: usa su propio límite de cuerpo (8 KB).
app.use("/analitica", analiticaRoutes);
require("./analitica/retencion").iniciarRetencion();

app.use(express.json());

app.use("/sessions", exigirTokenServicio, sessionsRoutes);
app.use("/pagos", pagosRoutes);
app.use("/tablas", tablasRoutes);
app.use("/contactos", contactosRoutes);
app.use("/bloqueados", bloqueadosRoutes);

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