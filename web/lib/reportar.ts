'use client';
import { supabaseNavegador } from './supabase/navegador';

// Reporta un error del navegador a public.errores_app (la RPC ignora a quien no tiene sesión y
// limita los reportes por hora). Nunca lanza: reportar no puede romper más la pantalla.
const vistos = new Set<string>();
export function reportarError(error: unknown, huella?: string) {
  try {
    const e = error as { message?: string; stack?: string; digest?: string };
    const mensaje = String(e?.message ?? error ?? '').slice(0, 500);
    const clave = `${location.pathname}|${mensaje}`;
    if (!mensaje || vistos.has(clave)) return;      // el mismo error en la misma pantalla, una sola vez
    vistos.add(clave);
    void supabaseNavegador().rpc('reportar_error', {
      p_ruta: location.pathname + location.search,
      p_mensaje: mensaje,
      p_detalle: e?.stack?.slice(0, 4000) ?? null,
      p_agente: navigator.userAgent.slice(0, 300),
      p_huella: huella ?? e?.digest ?? null,
    }).then(() => {}, () => {});
  } catch {
    // nada
  }
}
