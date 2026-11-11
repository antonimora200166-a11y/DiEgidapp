import path from 'node:path';
import type { NextConfig } from 'next';

// la app vive en web/; la raíz del repositorio tiene su propio package-lock (scripts y pruebas de la base)
const raiz = path.resolve('.');

const config: NextConfig = {
  outputFileTracingRoot: raiz,
  turbopack: { root: raiz },
  // el reporte de ventas de Odoo (Excel) llega por una acción del servidor: hasta 16 MB
  experimental: { serverActions: { bodySizeLimit: '16mb' } },
  async headers() {
    return [
      {
        // el service worker nunca se cachea: cada despliegue lo reemplaza de inmediato
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
};

export default config;
