import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SGI Di Égida',
    short_name: 'SGI Égida',
    description: 'Control operativo de bar y cocina — Di Égida, Tosca Bistró.',
    lang: 'es-CO',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f4ef',
    theme_color: '#7a2e2a',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icono-192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icono-512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
