'use client';
import { useRouter } from 'next/navigation';

type Opcion = { id: string; nombre: string; area: 'BAR' | 'COCINA'; seccion: string | null; pct: number | null; semaforo: string | null };
const MARCA: Record<string, string> = { VERDE: '🟢', AMARILLO: '🟡', ROJO: '🔴' };

export default function ElegirProducto({ opciones, actual, desde, hasta }: { opciones: Opcion[]; actual: string; desde: string; hasta: string }) {
  const router = useRouter();
  const grupos = new Map<string, Opcion[]>();
  for (const o of opciones) {
    const g = `${o.area === 'BAR' ? 'Bar' : 'Cocina'} · ${o.seccion ?? 'Sin sección'}`;
    grupos.set(g, [...(grupos.get(g) ?? []), o]);
  }
  return (
    <label style={{ display: 'block', margin: '.6rem 0 1rem', maxWidth: 520 }}>
      <span className="suave texto-nota">Producto</span>
      <select value={actual} onChange={(e) => router.push(`/consulta/simulador?${new URLSearchParams({ producto: e.target.value, desde, hasta })}`)}>
        <option value="">Escoja un producto…</option>
        {[...grupos].map(([g, lista]) => (
          <optgroup key={g} label={g}>
            {lista.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nombre}{o.pct != null ? ` · ${o.pct.toLocaleString('es-CO')} % ${MARCA[o.semaforo ?? ''] ?? ''}` : ' · sin costo completo'}
              </option>))}
          </optgroup>))}
      </select>
    </label>
  );
}
