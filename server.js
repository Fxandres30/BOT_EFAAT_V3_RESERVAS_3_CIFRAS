require("dotenv").config();

console.log("URL:", process.env.SUPABASE_URL);
console.log("KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0,20));

const express = require("express");
const cors = require("cors");

const sessionsRoutes = require("./routes/sessions");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/sessions", sessionsRoutes);

app.listen(4000, async () => {

    console.log("================================");
    console.log(" BOT API");
    console.log(" http://localhost:4000");
    console.log("================================");

    // await restaurarSesiones();

});
const supabase = require("./lib/supabase");
const { createSocket } = require("./services/baileys/socket");

async function restaurarSesiones() {

    const { data, error } = await supabase
        .from("sesiones")
        .select("id");

    if (error) {
        console.log(error);
        return;
    }

    console.log(`Restaurando ${data.length} sesiones...`);

    for (const sesion of data) {

        try {

            await createSocket(sesion.id);

            console.log("✅", sesion.id);

        } catch (err) {

            console.log("❌", sesion.id, err.message);

        }

    }

}