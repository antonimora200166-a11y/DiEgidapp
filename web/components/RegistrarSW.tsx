'use client';
import { useEffect } from 'react';

// Registra el service worker en producción (en desarrollo estorba la recarga en caliente).
export default function RegistrarSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);
  return null;
}
