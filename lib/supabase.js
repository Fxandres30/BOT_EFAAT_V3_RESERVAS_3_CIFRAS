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