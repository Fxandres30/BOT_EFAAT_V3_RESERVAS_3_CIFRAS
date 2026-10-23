// ==========================================================================
// «Mi cuenta» — datos y cambios del PROPIO usuario autenticado.
//
// Solo usa Supabase Auth (no hay tabla de perfil propia, ver
// services/auth/register.ts). El usuario siempre sale de auth.getUser() — la
// sesión del navegador —, nunca de un id o un correo recibido por parámetro,
// así que un cliente no puede leer ni cambiar la cuenta de otro.
//
// Qué se puede cambiar desde el panel:
//   - nombre (user_metadata.nombre): solo se muestra, ninguna parte del
//     panel ni del backend lo usa para autorizar nada.
//   - contraseña: solo tras comprobar la contraseña actual.
// El correo NO se cambia aquí: requiere un SMTP propio y las Redirect URLs
// de Supabase, que aún no están configurados.
//
// Lógica pura: el cliente de Auth se recibe como parámetro, así
// tests/cuenta la prueba sin Supabase. Sin imports a propósito.
// ==========================================================================

export const LONGITUD_MAXIMA_NOMBRE = 80;

interface Respuesta {
  error: { message?: string } | null;
}

interface UsuarioAuth {
  id: string;
  email?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

export interface AuthCuenta {
  getUser(): Promise<{ data: { user: UsuarioAuth | null }; error: unknown }>;
  updateUser(cambios: { data?: Record<string, unknown>; password?: string }): Promise<Respuesta>;
  signInWithPassword(credenciales: { email: string; password: string }): Promise<Respuesta & { data?: { user: UsuarioAuth | null } }>;
}

export interface PerfilCuenta {
  id: string;
  correo: string | null;
  nombre: string | null;
  creadaEn: string | null;
  ultimoAcceso: string | null;
  correoConfirmado: boolean;
}

export type Resultado = { ok: true } | { ok: false; error: string };

export function perfilDesdeUsuario(usuario: UsuarioAuth): PerfilCuenta {
  const nombre = usuario.user_metadata?.nombre;
  return {
    id: usuario.id,
    correo: usuario.email || null,
    nombre: typeof nombre === "string" && nombre.trim() ? nombre.trim() : null,
    creadaEn: usuario.created_at || null,
    ultimoAcceso: usuario.last_sign_in_at || null,
    correoConfirmado: !!usuario.email_confirmed_at
  };
}

export async function obtenerPerfil(auth: AuthCuenta): Promise<PerfilCuenta | null> {
  const { data } = await auth.getUser();
  return data.user ? perfilDesdeUsuario(data.user) : null;
}

// Nombre visible: sin caracteres de control y con un largo razonable.
export function validarNombre(valor: string): { ok: true; nombre: string } | { ok: false; error: string } {
  const nombre = valor.replace(/\s+/g, " ").trim();
  if (!nombre) return { ok: false, error: "Escribe tu nombre." };
  if (nombre.length > LONGITUD_MAXIMA_NOMBRE) return { ok: false, error: `El nombre admite como máximo ${LONGITUD_MAXIMA_NOMBRE} caracteres.` };
  if (/[\u0000-\u001f\u007f<>]/.test(nombre)) return { ok: false, error: "El nombre contiene caracteres no permitidos." };
  return { ok: true, nombre };
}

export async function actualizarNombre(auth: AuthCuenta, valor: string): Promise<Resultado> {
  const validado = validarNombre(valor);
  if (!validado.ok) return validado;

  const { data } = await auth.getUser();
  if (!data.user) return { ok: false, error: "Tu sesión terminó. Inicia sesión de nuevo." };

  // updateUser solo actúa sobre el usuario de la sesión y fusiona `data`
  // con el user_metadata existente.
  const { error } = await auth.updateUser({ data: { nombre: validado.nombre } });
  return error ? { ok: false, error: "No se pudo guardar el nombre. Inténtalo de nuevo." } : { ok: true };
}

// Cambio de contraseña con la sesión abierta. Antes de cambiarla se comprueba
// la actual: una sesión olvidada abierta en otro equipo no basta para
// quedarse con la cuenta. La validación de la nueva (largo, seguridad,
// confirmación) la hace el llamador con lib/auth/recuperacion.ts.
export async function cambiarContrasena(auth: AuthCuenta, actual: string, nueva: string): Promise<Resultado> {
  if (!actual) return { ok: false, error: "Escribe tu contraseña actual." };
  if (actual === nueva) return { ok: false, error: "La nueva contraseña debe ser distinta de la actual." };

  const { data } = await auth.getUser();
  const usuario = data.user;
  if (!usuario?.email) return { ok: false, error: "Tu sesión terminó. Inicia sesión de nuevo." };

  // El correo sale de la sesión, nunca de lo que escriba el usuario.
  const verificacion = await auth.signInWithPassword({ email: usuario.email, password: actual });
  if (verificacion.error || (verificacion.data?.user && verificacion.data.user.id !== usuario.id)) {
    return { ok: false, error: "La contraseña actual no es correcta." };
  }

  const { error } = await auth.updateUser({ password: nueva });
  if (error) {
    // Supabase puede exigir reautenticación por correo ("Secure password
    // change") o rechazar la contraseña por su propia política.
    return { ok: false, error: "No se pudo cambiar la contraseña. Si el problema continúa, usa «¿Olvidaste tu contraseña?» en el inicio de sesión." };
  }
  return { ok: true };
}

// "22 de octubre de 2026" en hora de Colombia, o null si no hay fecha.
export function formatearFecha(iso: string | null): string | null {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" });
}
