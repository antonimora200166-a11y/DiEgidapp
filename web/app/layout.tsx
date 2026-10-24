import type { Metadata, Viewport } from 'next';
import RegistrarSW from '@/components/RegistrarSW';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'SGI Di Égida', template: '%s · SGI Di Égida' },
  description: 'Control operativo de bar y cocina — Di Égida, Tosca Bistró.',
  applicationName: 'SGI Di Égida',
  appleWebApp: { capable: true, title: 'SGI Di Égida', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#7a2e2a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function Raiz({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO">
      <body>
        {children}
        <RegistrarSW />
      </body>
    </html>
  );
}
