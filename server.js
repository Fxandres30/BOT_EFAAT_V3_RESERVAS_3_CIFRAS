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

            await manager.start(

                sesion.id

            );

            console.log(

                "✅ Restaurada:",

                sesion.id

            );

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