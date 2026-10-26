import type { Instrumentation } from 'next';

// Todo error del servidor (páginas, acciones, proxy) queda en public.errores_app, para que
// administración lo vea en Registro. Se escribe con la clave de servicio por la API REST de
// Supabase (sirve igual en Node y en el proxy). Si el reporte mismo falla, no se insiste.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) return;
  const e = err as { message?: string; stack?: string; digest?: string };
  const agente = request.headers['user-agent'];
  try {
    await fetch(`${url}/rest/v1/errores_app`, {
      method: 'POST',
      headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        origen: 'SERVIDOR',
        usuario_id: null,
        ruta: `${request.method} ${request.path}`.slice(0, 300),
        mensaje: String(e?.message ?? err).slice(0, 500) || '(sin mensaje)',
        detalle: [`${context.routerKind} · ${context.routeType} · ${context.routePath}`, e?.stack].filter(Boolean).join('\n').slice(0, 4000),
        agente: (Array.isArray(agente) ? agente[0] : agente)?.slice(0, 300) ?? null,
        huella: e?.digest ?? null,
      }),
    });
  } catch {
    // sin red hacia Supabase: el error queda al menos en el registro de Vercel
  }
};
