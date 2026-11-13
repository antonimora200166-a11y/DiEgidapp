import type { Metadata, Viewport } from 'next';
import RegistrarSW from '@/components/RegistrarSW';
import ReportarErrores from '@/components/ReportarErrores';
import { Cormorant_Garamond, Montserrat } from 'next/font/google';
import { SCRIPT_TEMA } from '@/lib/tema';
import './globals.css';

// Tipografías del sistema gráfico: Cormorant Garamond (títulos) y Montserrat (todo lo demás), servidas desde la app
const cormorant = Cormorant_Garamond({ subsets: ['latin'], weight: ['500', '600'], style: ['normal', 'italic'], variable: '--font-cormorant', display: 'swap' });
const montserrat = Montserrat({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-montserrat', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'SGI Di Égida', template: '%s · SGI Di Égida' },
  description: 'Control operativo de bar y cocina — Di Égida, Tosca Bistró.',
  applicationName: 'SGI Di Égida',
  appleWebApp: { capable: true, title: 'SGI Di Égida', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0D3B33',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function Raiz({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO" className={`${cormorant.variable} ${montserrat.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} /></head>
      <body>
        {children}
        <RegistrarSW />
        <ReportarErrores />
      </body>
    </html>
  );
}
