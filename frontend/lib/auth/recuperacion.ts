// Recuperación de contraseña con Supabase Auth (mecanismo oficial de
// supabase-js 2.x: resetPasswordForEmail + sesión de recuperación +
// updateUser). Lógica pura: el cliente de Auth se recibe como parámetro, así
// que las pantallas usan el cliente único de lib/supabase.ts y las pruebas
// usan un doble.
//
// Flujo:
//   1. /recuperar-contrasena: resetPasswordForEmail(correo, { redirectTo })
//      con redirectTo = ORIGEN ACTUAL + /restablecer-contrasena. Nunca se
//      acepta un destino enviado por el usuario (sin redirecciones abiertas);
//      además Supabase solo redirige a las URL de su lista permitida.
//   2. El enlace del correo vuelve a /restablecer-contrasena:
//        - plantilla por defecto (flujo implícito, el del cliente actual):
//          #access_token=…&type=recovery. supabase-js crea la sesión y limpia
//          el hash. Solo se acepta si la sesión resultante es EXACTAMENTE la
//          del enlace: si el enlace falla, supabase-js conserva una sesión
//          anterior y esa no debe permitir el cambio.
//        - plantilla con token_hash (opcional): ?token_hash=…&type=recovery
//          -> verifyOtp({ type: "recovery", token_hash }).
//        - enlace caducado, inválido o ya usado: Supabase devuelve
//          error_code (p. ej. otp_expired) en el hash o en la consulta.
//   3. updateUser({ password }) y cierre de sesión: se entra de nuevo con la
//      contraseña nueva.
//
// Nunca se registran contraseñas, tokens ni correos.
//
// Sin imports a propósito: tests/auth la carga transpilándola directamente.

export const RUTA_RESTABLECER = "/restablecer-contrasena";
export const RUTA_SOLICITAR = "/recuperar-contrasena";

interface ErrorAuth {
  name?: string;
  code?: string;
  status?: number;
  message?: string;
}

interface Respuesta {
  error: ErrorAuth | null;
  data?: unknown;
}

// Subconjunto de supabase.auth que usa este flujo.
export interface ClienteAuthRecuperacion {
  resetPasswordForEmail(email: string, opciones: { redirectTo: string }): Promise<Respuesta>;
  getSession(): Promise<{ data: { session: { access_token: string; user?: { email?: string } } | null }; error?: ErrorAuth | null }>;
  verifyOtp(parametros: { type: "recovery"; token_hash: string }): Promise<Respuesta>;
  updateUser(cambios: { password: string }): Promise<Respuesta>;
}

// ------------------------------------------------------------ redirección ---

// URL de retorno a partir del ORIGEN de la página actual (window.location.origin).
// Solo http(s) y sin ruta, consulta ni credenciales: cualquier otra cosa -> null.
export function urlRestablecer(origen: string): string | null {
  let url: URL;
  try {
    url = new URL(origen);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.origin !== origen.replace(/\/$/, "")) return null;
  return `${url.origin}${RUTA_RESTABLECER}`;
}

// ------------------------------------------------------------ el enlace ---

export type EnlaceRecuperacion =
  | { tipo: "implicito"; accessToken: string }
  | { tipo: "token_hash"; tokenHash: string }
  | { tipo: "error"; codigo: string }
  | { tipo: "ninguno" };

// Lee lo que trae la URL de vuelta (hash y consulta), sin modificar nada.
export function leerEnlaceRecuperacion(href: string): EnlaceRecuperacion {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { tipo: "ninguno" };
  }

  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const consulta = url.searchParams;
  const leer = (clave: string) => hash.get(clave) ?? consulta.get(clave);

  const codigoError = leer("error_code") || leer("error");
  if (codigoError || leer("error_description")) return { tipo: "error", codigo: codigoError || "desconocido" };

  const tipo = leer("type");
  const accessToken = hash.get("access_token");
  if (accessToken && tipo === "recovery") return { tipo: "implicito", accessToken };

  const tokenHash = consulta.get("token_hash");
  if (tokenHash && tipo === "recovery") return { tipo: "token_hash", tokenHash };

  // Otro tipo de enlace (confirmación de registro, ?code= de un flujo que el
  // panel no usa…) o ninguno: no habilita el cambio de contraseña.
  return { tipo: "ninguno" };
}

// Enlace de recuperación que llegó a OTRA página (p. ej. al Site URL porque
// Supabase no aceptó el redirectTo): la misma URL en /restablecer-contrasena,
// con su hash y consulta intactos. null si no es un enlace de recuperación o
// si ya está en su sitio. Mismo origen siempre: no hay redirección abierta.
export function destinoEnlaceRecuperacion(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.pathname.replace(/\/$/, "") === RUTA_RESTABLECER) return null;

  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  if (hash.get("type") !== "recovery" && url.searchParams.get("type") !== "recovery") return null;

  return `${url.origin}${RUTA_RESTABLECER}${url.search}${url.hash}`;
}

// La URL sin hash ni parámetros del enlace, para no dejar tokens ni códigos
// de error en el historial ni en la barra de direcciones.
export function urlSinDatosDeEnlace(href: string): string {
  try {
    const url = new URL(href);
    for (const clave of ["token_hash", "type", "code", "error", "error_code", "error_description"]) url.searchParams.delete(clave);
    url.hash = "";
    return url.toString();
  } catch {
    return href;
  }
}

// ------------------------------------------------------------- mensajes ---

export type MotivoEnlace = "caducado" | "invalido" | "sin_enlace" | "red";

export function mensajeEnlace(motivo: MotivoEnlace): string {
  switch (motivo) {
    case "caducado":
      return "El enlace caducó o ya se utilizó. Solicita uno nuevo para cambiar tu contraseña.";
    case "red":
      return "No se pudo comprobar el enlace por un problema de conexión. Revisa tu internet e inténtalo de nuevo.";
    case "sin_enlace":
      return "Para cambiar tu contraseña abre el enlace que te enviamos por correo, o solicita uno nuevo.";
    default:
      return "El enlace no es válido. Solicita uno nuevo para cambiar tu contraseña.";
  }
}

const esErrorDeRed = (e: ErrorAuth | null | undefined) =>
  !!e && (e.name === "AuthRetryableFetchError" || e.name === "TypeError" || e.status === 0);

const CODIGOS_CADUCADO = new Set(["otp_expired", "flow_state_expired", "access_denied", "session_not_found", "bad_jwt"]);

function motivoDeCodigo(codigo: string | undefined): MotivoEnlace {
  return codigo && CODIGOS_CADUCADO.has(codigo) ? "caducado" : "invalido";
}

// ---------------------------------------------------------- 1. solicitar ---

export const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ResultadoSolicitud =
  | { ok: true }
  | { ok: false; motivo: "correo_invalido" | "limite" | "red" | "configuracion" };

// La respuesta nunca revela si el correo tiene cuenta: Supabase responde
// igual en ambos casos y aquí cualquier error que no sea de formato, límite
// de envíos, red o configuración del panel se presenta como éxito.
export async function solicitarRecuperacion(auth: ClienteAuthRecuperacion, correo: string, origen: string): Promise<ResultadoSolicitud> {
  const email = correo.trim();
  if (!CORREO_VALIDO.test(email)) return { ok: false, motivo: "correo_invalido" };

  const redirectTo = urlRestablecer(origen);
  if (!redirectTo) return { ok: false, motivo: "configuracion" };

  let error: ErrorAuth | null;
  try {
    ({ error } = await auth.resetPasswordForEmail(email, { redirectTo }));
  } catch (e) {
    error = e as ErrorAuth;
  }

  if (!error) return { ok: true };
  if (esErrorDeRed(error)) return { ok: false, motivo: "red" };
  if (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit" || error.status === 429) return { ok: false, motivo: "limite" };
  if (error.code === "email_address_invalid" || error.code === "validation_failed") return { ok: false, motivo: "correo_invalido" };

  console.warn("[RECUPERACION] la solicitud devolvió un error no mostrado al usuario:", error.code || error.name || "sin código");
  return { ok: true };
}

export function mensajeSolicitud(motivo: "correo_invalido" | "limite" | "red" | "configuracion"): string {
  switch (motivo) {
    case "correo_invalido":
      return "Escribe un correo válido.";
    case "limite":
      return "Se hicieron demasiadas solicitudes. Espera unos minutos antes de intentarlo de nuevo.";
    case "red":
      return "No se pudo conectar. Revisa tu internet e inténtalo de nuevo.";
    default:
      return "No se pudo preparar la solicitud. Inténtalo de nuevo más tarde.";
  }
}

// ----------------------------------------------------- 2. verificar enlace ---

export type ResultadoVerificacion =
  | { ok: true; correo: string | null }
  | { ok: false; motivo: MotivoEnlace };

export async function verificarEnlace(auth: ClienteAuthRecuperacion, enlace: EnlaceRecuperacion): Promise<ResultadoVerificacion> {
  try {
    if (enlace.tipo === "error") return { ok: false, motivo: motivoDeCodigo(enlace.codigo) };
    if (enlace.tipo === "ninguno") return { ok: false, motivo: "sin_enlace" };

    if (enlace.tipo === "token_hash") {
      const { error } = await auth.verifyOtp({ type: "recovery", token_hash: enlace.tokenHash });
      if (error) return { ok: false, motivo: esErrorDeRed(error) ? "red" : motivoDeCodigo(error.code ?? "otp_expired") };
    }

    // getSession espera a que supabase-js termine de procesar el enlace.
    const { data, error } = await auth.getSession();
    if (error) return { ok: false, motivo: esErrorDeRed(error) ? "red" : "invalido" };

    const sesion = data.session;
    if (!sesion) return { ok: false, motivo: "caducado" };

    // Flujo implícito: la sesión tiene que ser la del enlace, no una anterior.
    if (enlace.tipo === "implicito" && sesion.access_token !== enlace.accessToken) return { ok: false, motivo: "caducado" };

    return { ok: true, correo: sesion.user?.email ?? null };
  } catch (e) {
    return { ok: false, motivo: esErrorDeRed(e as ErrorAuth) ? "red" : "invalido" };
  }
}

// ------------------------------------------------------ 3. nueva contraseña ---

export function validarNuevaContrasena(password: string, confirmacion: string, cumpleMinimo: boolean, longitudMinima: number): string | null {
  if (!password || !confirmacion) return "Escribe la nueva contraseña y su confirmación.";
  if (password.length < longitudMinima) return `La contraseña debe tener al menos ${longitudMinima} caracteres.`;
  if (!cumpleMinimo) return "La contraseña es demasiado fácil de adivinar. Sigue las recomendaciones.";
  if (password !== confirmacion) return "Las contraseñas no coinciden.";
  return null;
}

export type ResultadoActualizacion =
  | { ok: true }
  | { ok: false; motivo: "misma" | "debil" | "enlace" | "red" | "otro"; mensaje: string };

export async function actualizarContrasena(auth: ClienteAuthRecuperacion, password: string): Promise<ResultadoActualizacion> {
  let error: ErrorAuth | null;
  try {
    ({ error } = await auth.updateUser({ password }));
  } catch (e) {
    error = e as ErrorAuth;
  }

  if (!error) return { ok: true };
  if (esErrorDeRed(error)) return { ok: false, motivo: "red", mensaje: "No se pudo guardar por un problema de conexión. Inténtalo de nuevo." };
  if (error.code === "same_password") return { ok: false, motivo: "misma", mensaje: "La nueva contraseña debe ser distinta de la anterior." };
  if (error.code === "weak_password" || error.name === "AuthWeakPasswordError") return { ok: false, motivo: "debil", mensaje: "La contraseña no cumple los requisitos de seguridad. Elige una más larga o difícil de adivinar." };
  if (error.name === "AuthSessionMissingError" || error.code === "session_not_found" || error.code === "bad_jwt" || error.code === "reauthentication_needed" || error.status === 401 || error.status === 403) {
    return { ok: false, motivo: "enlace", mensaje: mensajeEnlace("caducado") };
  }

  console.warn("[RECUPERACION] no se pudo actualizar la contraseña:", error.code || error.name || "sin código");
  return { ok: false, motivo: "otro", mensaje: "No se pudo cambiar la contraseña. Inténtalo de nuevo." };
}
