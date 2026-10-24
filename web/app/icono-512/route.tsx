import { iconoPng } from '@/lib/icono';

export const dynamic = 'force-static';
export function GET() {
  return iconoPng(512);
}
