'use client';
import { useEffect } from 'react';

// Registra el service worker en producción. En desarrollo quita el que haya quedado de una prueba
// anterior en el mismo puerto: estorba la recarga y muestra «Sin conexión» mientras compila.
export default function RegistrarSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      return;
    }
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);
  return null;
}
