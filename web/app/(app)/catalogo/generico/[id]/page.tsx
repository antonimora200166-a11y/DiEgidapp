import { notFound, redirect } from 'next/navigation';
import { supabaseServidor } from '@/lib/supabase/server';

// Del genérico (lo que piden las fichas) a su producto en el catálogo: la presentación activa,
// primero la que ya tiene costo. Si no tiene presentaciones, al buscador del catálogo.
export default async function GenericoAProducto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await supabaseServidor();
  const { data: g } = await supabase.from('genericos').select('nombre').eq('id', id).maybeSingle();
  if (!g) notFound();
  const { data: productos } = await supabase.from('productos').select('id, activo, codigo').eq('generico_id', id)
    .order('activo', { ascending: false }).order('codigo');
  const ids = (productos ?? []).map((p) => p.id as string);
  if (!ids.length) redirect(`/catalogo?q=${encodeURIComponent(g.nombre as string)}`);
  const { data: conCosto } = await supabase.from('costos_referencia').select('producto_id').in('producto_id', ids);
  const conCostoIds = new Set((conCosto ?? []).map((c) => c.producto_id as string));
  const elegido = (productos ?? []).find((p) => p.activo && conCostoIds.has(p.id as string)) ?? productos![0];
  redirect(`/catalogo/producto/${elegido.id}`);
}
