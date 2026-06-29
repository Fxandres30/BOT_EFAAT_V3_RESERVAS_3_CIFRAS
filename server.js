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

app.listen(4000, () => {

    console.log("================================");
    console.log(" BOT API");
    console.log(" http://localhost:4000");
    console.log("================================");

});