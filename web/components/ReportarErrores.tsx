'use client';
import { useEffect } from 'react';
import { reportarError } from '@/lib/reportar';

// Fallos sueltos del navegador (fuera de una pantalla de error): un botón que revienta, una promesa sin manejar.
export default function ReportarErrores() {
  useEffect(() => {
    const alError = (ev: ErrorEvent) => reportarError(ev.error ?? ev.message);
    const alRechazo = (ev: PromiseRejectionEvent) => reportarError(ev.reason);
    window.addEventListener('error', alError);
    window.addEventListener('unhandledrejection', alRechazo);
    return () => {
      window.removeEventListener('error', alError);
      window.removeEventListener('unhandledrejection', alRechazo);
    };
  }, []);
  return null;
}
