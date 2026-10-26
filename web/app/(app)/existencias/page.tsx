import Link from 'next/link';
import { redirect } from 'next/navigation';
import { perfilActual } from '@/lib/sesion';
import { supabaseServidor } from '@/lib/supabase/server';
import { areasDe, type Area } from '@/lib/roles';
import { fmtCantidad } from '@/lib/catalogo';

export const metadata = { title: 'Existencias' };

type Fila = { producto_id: string; producto_codigo: string; generico: string; marca: string; presentacion: string;
              unidad_base: string; area: Area; ubicacion: string; cantidad: number; costo_promedio: number | null; valor: number | null };
const pesos = (n: number) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

export default async function Existencias({ searchParams }: { searchParams: Promise<{ zona?: string }> }) {
  const perfil = await perfilActual();
  if (perfil.rol === 'servicio') redirect('/');
  const { zona } = await searchParams;
  const areas: Area[] = areasDe(perfil).length ? areasDe(perfil) : ['BAR', 'COCINA'];
  const supabase = await supabaseServidor();
  const { data: zonas } = await supabase.from('ubicaciones').select('codigo, nombre, area').in('area', areas).order('area').order('nombre');
  let c = supabase.from('v_existencias').select('*').in('area', areas).neq('cantidad', 0).order('generico').limit(2000);
  if (zona) c = c.eq('ubicacion', zona);
  const { data } = await c;
  const filas = (data ?? []) as Fila[];
  const total = filas.reduce((t, f) => t + Number(f.valor ?? 0), 0);
  const sinCosto = filas.filter((f) => f.costo_promedio === null).length;
  const negativos = filas.filter((f) => f.cantidad < 0).length;
  const nombreZona = (u: string) => zonas?.find((z) => z.codigo === u)?.nombre ?? u;
  const activo = { background: 'var(--marca)', color: 'var(--marca-texto)', borderColor: 'var(--marca)' };

  return (
    <>
      <h1>Existencias</h1>
      <nav className="segmentos" style={{ marginBottom: '1rem' }}>
        <Link href="/existencias"><span style={!zona ? activo : undefined}>Todas las zonas</span></Link>
        {(zonas ?? []).map((z) => (
          <Link key={z.codigo} href={`/existencias?zona=${z.codigo}`}><span style={zona === z.codigo ? activo : undefined}>{z.nombre}</span></Link>
        ))}
      </nav>
      {filas.length ? (
        <>
          <div className="tarjeta" style={{ marginBottom: '1rem' }}>
            <div className="suave" style={{ fontSize: '.85rem' }}>Valor del inventario{zona ? ` en ${nombreZona(zona)}` : ''}</div>
            <strong style={{ fontSize: '1.5rem' }}>{pesos(total)}</strong>
            <div className="suave" style={{ fontSize: '.85rem' }}>
              {filas.length} producto(s) con saldo{sinCosto > 0 && ` · ${sinCosto} sin costo todavía`}{negativos > 0 && ` · ${negativos} en negativo`}
            </div>
          </div>
          <div className="desborde">
            <table className="tabla">
              <thead><tr><th>Producto</th>{!zona && <th>Zona</th>}<th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.producto_id + f.ubicacion}>
                    <td>
                      {f.generico}{f.marca && ` · ${f.marca}`}
                      <div className="suave" style={{ fontSize: '.8rem' }}>{f.presentacion}</div>
                    </td>
                    {!zona && <td className="suave" style={{ fontSize: '.85rem' }}>{nombreZona(f.ubicacion)}</td>}
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: f.cantidad < 0 ? 'var(--error)' : undefined }}>
                      {fmtCantidad(Number(f.cantidad))} {f.unidad_base}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{f.valor === null ? <span className="suave">sin costo</span> : pesos(Number(f.valor))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="tarjeta">
          No hay existencias{zona ? ` en ${nombreZona(zona)}` : ''} todavía. El kardex nace con el <Link href="/conteo">conteo inicial</Link> de cada zona.
        </p>
      )}
    </>
  );
}
