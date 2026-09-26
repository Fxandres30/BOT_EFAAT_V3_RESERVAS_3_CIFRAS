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

// Nunca se loguean SUPABASE_URL ni ningún fragmento de la service role key.

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
// PRUEBA DE CONEXIÓN — solo resultado, nunca datos de filas (la tabla
// sesiones contiene el QR de vinculación).
// ===============================
(async () => {
  try {
    const { error } = await supabase
      .from("sesiones")
      .select("id", { count: "exact", head: true });

    if (error) {
      console.log("❌ [SUPABASE] error de conexión:", error.message);
    } else {
      console.log("✅ [SUPABASE] conexión exitosa");
    }
  } catch (err) {
    console.log("💥 [SUPABASE] excepción de conexión:", err.message);
  }
})();

module.exports = supabase;