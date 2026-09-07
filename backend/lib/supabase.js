const path = require("path");

// Ancla la carga de .env a la ubicación REAL de este archivo
// (backend/lib/supabase.js -> backend/.env), en vez de depender del
// directorio de trabajo desde el que se haya invocado `node` (que es lo
// que hace `require("dotenv").config()` sin `path`). server.js ya llama a
// dotenv.config() sin ruta y sigue funcionando igual que antes: por
// defecto dotenv NUNCA sobreescribe una variable que ya esté en
// process.env, así que esta llamada es un no-op cuando el .env correcto
// ya se cargó, y es la que efectivamente resuelve las variables cuando
// un script (p. ej. backend/pagos/crearDispositivo.js) se ejecuta desde
// otro directorio (la raíz del repo, por ejemplo).
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { createClient } = require("@supabase/supabase-js");

console.log("================================");
console.log("🔗 SUPABASE");
console.log("================================");
console.log("URL:", process.env.SUPABASE_URL);

console.log(
  "SECRET KEY:",
  process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 25) + "..."
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

// ===============================
// PRUEBA DE CONEXIÓN
// ===============================
(async () => {
  console.log("");
  console.log("================================");
  console.log("🧪 PROBANDO SUPABASE");
  console.log("================================");

  try {
    const { data, error } = await supabase
      .from("sesiones")
      .select("*")
      .limit(1);

    if (error) {
      console.log("❌ ERROR");
      console.dir(error, { depth: null });
    } else {
      console.log("✅ CONEXIÓN EXITOSA");
      console.log("Filas encontradas:", data.length);
      console.log(data);
    }
  } catch (err) {
    console.log("💥 EXCEPCIÓN");
    console.error(err);
  }

  console.log("================================");
})();

module.exports = supabase;