require("dotenv").config();

const express = require("express");
const cors = require("cors");

const sessionsRoutes = require("./routes/sessions");
const pagosRoutes = require("./routes/pagos");
const tablasRoutes = require("./routes/tablas");
const contactosRoutes = require("./routes/contactos");
const bloqueadosRoutes = require("./routes/bloqueados");
const analiticaRoutes = require("./routes/analitica");
// Sorteos programados, plantillas y cuentas de pago (panel multiusuario):
// exigen token de servicio + sesión real del usuario.
const sorteosRoutes = require("./routes/sorteos");

const supabase = require("./lib/supabase");

const manager =
require("./services/baileys/manager");

// Restauración de TODAS las sesiones al arrancar (multisesión).
const { restaurarSesiones } = require("./services/baileys/restaurarSesiones");

// Al detener el proceso (PM2), suelta los leases de las sesiones de este
// proceso para que el siguiente arranque las restaure sin esperar el TTL.
require("./services/baileys/apagadoOrdenado").instalarApagadoOrdenado({
    manager,
    lease: require("./services/baileys/lease")
});

const app = express();

app.use(cors());

// Antes del express.json() global: usa su propio límite de cuerpo (8 KB).
app.use("/analitica", analiticaRoutes);
require("./analitica/retencion").iniciarRetencion();

// «Compartir tabla» envía la captura PNG de la tabla en base64: límite
// propio (el global es de 100 KB). routes/tablas.js valida tipo y tamaño.
app.use("/tablas/compartir", express.json({ limit: "6mb" }));
// «Publicar ahora» lleva la MISMA captura del panel (sorteos/servicio.js la valida igual).
app.use(/^\/sorteos\/[^/]+\/publicar-ahora$/, express.json({ limit: "6mb" }));

app.use(express.json());

app.use("/sessions", sessionsRoutes);
app.use("/pagos", pagosRoutes);
app.use("/tablas", tablasRoutes);
app.use("/contactos", contactosRoutes);
app.use("/bloqueados", bloqueadosRoutes);
app.use("/sorteos", sorteosRoutes);

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
