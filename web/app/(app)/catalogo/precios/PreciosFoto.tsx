'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseNavegador } from '@/lib/supabase/navegador';
import type { Area } from '@/lib/roles';
import { TIPOS_INSUMO, type TipoInsumo } from '@/lib/clases';
import { crearDesdeFoto, guardarPrecios, leerPrecios, type LineaPrecio } from './acciones';

export type ProductoPrecio = {
  producto_id: string; codigo: string; generico: string; marca: string; presentacion: string; categoria: string;
  unidad_base: 'g' | 'ml' | 'und'; unidad_compra: string; contenido_base: number | null; contenido_variable: boolean;
  costo_promedio: number | null; area: Area; costo_ref: number | null;
  peso_und: number | null;   // cuánto pesa 1 und, si el genérico ya lo sabe (conversión)
};

// en qué viene la cantidad de la foto
type Unidad = 'g' | 'kg' | 'lb' | 'ml' | 'L' | 'und' | 'empaque';
const UNIDADES: { v: Unidad; t: string }[] = [
  { v: 'kg', t: 'kg' }, { v: 'lb', t: 'libra (500 g)' }, { v: 'g', t: 'g' }, { v: 'L', t: 'litro' }, { v: 'ml', t: 'ml' },
  { v: 'und', t: 'unidad' }, { v: 'empaque', t: 'empaque del producto' },
];

type Pres = { presentacion: string; unidad_compra: string; contenido: string; variable: boolean };
// nombre genérico y marca que sugiere la IA desde el nombre de la factura
type Renombre = { nombre: string; marca: string; cambiarNombre: boolean; cambiarMarca: boolean };
// producto nuevo desde la línea: genérico nuevo u otra presentación de uno existente
type Nuevo = {
  modo: 'nuevo' | 'presentacion'; generico_id: string; nombre: string; tipo: TipoInsumo; unidad_base: 'g' | 'ml' | 'und';
  categoria: string; marca: string; presentacion: string; unidad_compra: string; contenido: string; variable: boolean;
  motivo: string; bloqueos: string[]; error: string | null; enviando: boolean;
};
type Linea = {
  n: number; descripcion: string; leida: LineaPrecio; producto_id: string | null; buscar: string;
  cantidad: string; unidad: Unidad; peso: string; valor: string; fijar: boolean; ignorar: boolean; corregir: boolean; pres: Pres; ren: Renombre; nuevo: Nuevo | null;
  resultado: { ok: boolean; mensaje: string } | null;
};
type Foto = {
  id: string; ruta: string | null; vista: string | null; estado: 'subiendo' | 'leyendo' | 'listo' | 'error' | 'guardado';
  error: string | null; tipo: string | null; notas: string | null; proveedor: string; proveedor_id: string; sugeridos: string[];
  del_proveedor: string[]; proveedor_razon: string | null; documento: string; fecha: string; lineas: Linea[];
};

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const pesos = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—'
  : `$${n.toLocaleString('es-CO', { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 0 })}`);
const cant = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('es-CO', { maximumFractionDigits: 3 }));
// «2.500» = 2500 · «0,75» = 0.75 · «$ 20.000» = 20000
const numero = (t: string) => {
  const x = t.replace(/[$\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(x)) return Number(x.replace(/\./g, '').replace(',', '.'));
  return Number(x.replace(',', '.'));
};
const COSTO_CREIBLE = { g: [0.5, 400], ml: [0.5, 600], und: [20, 1000000] } as const;

// Foto liviana para subir y para la IA: lado mayor de 2.000 px en JPEG (igual que Recibir).
async function reducir(archivo: File): Promise<{ blob: Blob; tipo: string; ext: string }> {
  if (archivo.type === 'application/pdf') return { blob: archivo, tipo: 'application/pdf', ext: 'pdf' };
  try {
    const img = await createImageBitmap(archivo);
    const k = Math.min(1, 2000 / Math.max(img.width, img.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(img.width * k);
    lienzo.height = Math.round(img.height * k);
    lienzo.getContext('2d')!.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.85));
    if (blob) return { blob, tipo: 'image/jpeg', ext: 'jpg' };
  } catch { /* formato que el navegador no decodifica: se sube tal cual */ }
  const ext = archivo.type === 'image/png' ? 'png' : archivo.type === 'image/webp' ? 'webp' : 'jpg';
  return { blob: archivo, tipo: archivo.type || 'image/jpeg', ext };
}

// la unidad escrita en la foto → la de la pantalla (y un factor, para «media libra» o «galón»)
function unidadLeida(texto: string | null, p: ProductoPrecio | undefined): { unidad: Unidad; factor: number } {
  const t = normal(texto ?? '');
  if (/media libra/.test(t)) return { unidad: 'lb', factor: 0.5 };
  if (/^(kg|kgs|kilo|kilos|kilogramo)/.test(t)) return { unidad: 'kg', factor: 1 };
  if (/^(lb|lbs|libra)/.test(t)) return { unidad: 'lb', factor: 1 };
  if (/^(g|gr|grs|gramo)/.test(t)) return { unidad: 'g', factor: 1 };
  if (/^(ml|cc|mililitro)/.test(t)) return { unidad: 'ml', factor: 1 };
  if (/^(galon|gal)/.test(t)) return { unidad: 'L', factor: 3.785 };
  if (/^(l|lt|lts|litro)/.test(t)) return { unidad: 'L', factor: 1 };
  if (p && p.unidad_base !== 'und' && !p.contenido_variable && p.contenido_base) return { unidad: 'empaque', factor: 1 };
  return { unidad: 'und', factor: 1 };
}

// «2,5KG», «1000 g», «750 ml» en la línea: lo que pesa o mide cada unidad comprada
function cantidadEscrita(t: string | null): { n: number; unidad: Unidad } | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(kg|kilo|kilos|g|gr|grs|ml|cc|l|lt|litro|litros)\b/i.exec(t ?? '');
  if (!m) return null;
  const n = Number(m[1].replace(',', '.')), u = m[2].toLowerCase();
  if (!(n > 0)) return null;
  return { n, unidad: /^(kg|kilo)/.test(u) ? 'kg' : /^(g|gr)/.test(u) ? 'g' : /^(ml|cc)/.test(u) ? 'ml' : 'L' };
}

// cantidad en la unidad base del producto, o el motivo por el que no se puede
function aBase(l: Linea, p: ProductoPrecio | undefined): { base: number | null; problema: string | null } {
  const c = numero(l.cantidad);
  if (!p) return { base: null, problema: 'Elige el producto.' };
  if (!(c > 0)) return { base: null, problema: 'Falta la cantidad.' };
  const ub = p.unidad_base;
  switch (l.unidad) {
    case 'g': case 'kg': case 'lb':
      return ub === 'g' ? { base: c * (l.unidad === 'kg' ? 1000 : l.unidad === 'lb' ? 500 : 1), problema: null }
        : { base: null, problema: `${p.generico} va en ${ub}: la cantidad no puede ir en peso.` };
    case 'ml': case 'L':
      return ub === 'ml' ? { base: c * (l.unidad === 'L' ? 1000 : 1), problema: null }
        : { base: null, problema: `${p.generico} va en ${ub}: la cantidad no puede ir en volumen.` };
    case 'und': {
      if (ub === 'und') return { base: c, problema: null };
      const peso = l.peso.trim() ? numero(l.peso) : Number(p.peso_und);
      return peso > 0 ? { base: c * peso, problema: null }
        : { base: null, problema: `${p.generico} va en ${ub}: escribe cuánto pesa cada unidad (aprox.).` };
    }
    case 'empaque': {
      const cont = l.corregir && !l.pres.variable ? numero(l.pres.contenido) : p.contenido_variable ? NaN : Number(p.contenido_base);
      return cont > 0 ? { base: c * cont, problema: null } : { base: null, problema: 'El empaque de este producto no tiene contenido fijo: usa kg, g, litro o ml.' };
    }
  }
}

// lo que dice la foto → valores de partida del producto nuevo
function nuevoDesde(l: LineaPrecio): Nuevo {
  const u = normal(l.unidad ?? '');
  const m = /(\d+(?:[.,]\d+)?)\s*(kg|kilo|g|gr|grs|ml|cc|l|lt|litro)s?\b/i.exec(l.presentacion ?? l.descripcion);
  let ub: Nuevo['unidad_base'] = /^(kg|kilo|lb|libra|media libra|g|gr)/.test(u) ? 'g' : /^(l|lt|litro|ml|cc|galon)/.test(u) ? 'ml' : 'und';
  let contenido = '', ucompra = 'UND', variable = false;
  if (m) {
    const n = Number(m[1].replace(',', '.')), un = m[2].toLowerCase();
    ub = /^(kg|kilo|g|gr)/.test(un) ? 'g' : 'ml';
    contenido = String(Math.round(n * (/^(kg|kilo|l|lt|litro)$/.test(un) ? 1000 : 1) * 1000) / 1000);
  } else if (/^(kg|kilo)/.test(u)) { ucompra = 'KG'; contenido = '1000'; }
  else if (/^(lb|libra|media libra)/.test(u)) { ucompra = 'LB'; contenido = '500'; }
  else if (/^(l|lt|litro)$/.test(u)) { ucompra = 'LT'; contenido = '1000'; }
  else if (ub === 'und') { contenido = '1'; }
  else variable = true;
  return { modo: 'nuevo', generico_id: '', nombre: l.nombre_generico ?? l.descripcion, tipo: 'MPe', unidad_base: ub, categoria: '',
           marca: l.marca ?? '', presentacion: l.presentacion ?? (ucompra === 'KG' || ucompra === 'LB' ? 'Granel' : ''), unidad_compra: ucompra,
           contenido, variable, motivo: '', bloqueos: [], error: null, enviando: false };
}

export default function PreciosFoto({ areas, productos: inicial, proveedores, categorias }: {
  areas: Area[]; productos: ProductoPrecio[]; proveedores: { id: string; nombre: string }[]; categorias: { codigo: string; nombre: string; area: Area }[];
}) {
  const router = useRouter();
  const [productos, setProductos] = useState(inicial);
  const [area, setArea] = useState<Area>(areas[0]);
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [guardando, setGuardando] = useState<string | null>(null);
  const porId = useMemo(() => new Map(productos.map((p) => [p.producto_id, p])), [productos]);
  const delArea = useMemo(() => productos.filter((p) => p.area === area), [productos, area]);

  const cambiarFoto = (id: string, f: (x: Foto) => Foto) => setFotos((xs) => xs.map((x) => (x.id === id ? f(x) : x)));
  const cambiarLinea = (id: string, n: number, f: (l: Linea) => Linea) =>
    cambiarFoto(id, (x) => ({ ...x, lineas: x.lineas.map((l) => (l.n === n ? f(l) : l)) }));

  function presDe(p: ProductoPrecio | undefined, leida: LineaPrecio): Pres {
    return { presentacion: leida.presentacion ?? p?.presentacion ?? '', unidad_compra: p?.unidad_compra ?? '',
             contenido: p?.contenido_base == null ? '' : String(p.contenido_base), variable: !!p?.contenido_variable };
  }
  function renDe(p: ProductoPrecio | undefined, leida: LineaPrecio): Renombre {
    return { nombre: leida.nombre_generico ?? p?.generico ?? '', marca: leida.marca ?? p?.marca ?? '', cambiarNombre: false, cambiarMarca: false };
  }
  function elegir(id: string, n: number, producto_id: string | null) {
    cambiarLinea(id, n, (l) => {
      const p = producto_id ? porId.get(producto_id) : undefined;
      const u = unidadLeida(l.leida.unidad, p);
      return { ...l, producto_id, buscar: '', pres: presDe(p, l.leida), ren: renDe(p, l.leida), unidad: l.unidad === 'empaque' || !p ? u.unidad : l.unidad };
    });
  }

  async function subir(archivos: FileList | null) {
    if (!archivos?.length) return;
    for (const archivo of Array.from(archivos)) {
      const id = crypto.randomUUID();
      const base: Foto = { id, ruta: null, vista: null, estado: 'subiendo', error: null, tipo: null, notas: null,
                           proveedor: '', proveedor_id: '', sugeridos: [], del_proveedor: [], proveedor_razon: null, documento: '', fecha: '', lineas: [] };
      setFotos((xs) => [base, ...xs]);
      try {
        const { blob, tipo, ext } = await reducir(archivo);
        const ruta = `${area}/${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabaseNavegador().storage.from('facturas').upload(ruta, blob, { contentType: tipo, upsert: false });
        if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
        cambiarFoto(id, (x) => ({ ...x, ruta, vista: tipo === 'application/pdf' ? null : URL.createObjectURL(blob), estado: 'leyendo' }));
        const r = await leerPrecios(ruta, area);
        if (!r.ok) { cambiarFoto(id, (x) => ({ ...x, estado: 'error', error: r.error })); continue; }
        const l = r.lectura;
        const lineas: Linea[] = r.lineas.map((x, i) => {
          const sugerido = x.candidatos[0]?.parecido >= 0.75 ? x.candidatos[0].producto_id
            : x.sugerencia_ia?.producto_id && x.sugerencia_ia.confianza !== 'baja' ? x.sugerencia_ia.producto_id
            : x.candidatos[0]?.producto_id ?? null;
          const p = sugerido ? porId.get(sugerido) : undefined;
          let u = unidadLeida(x.unidad, p);
          let c = x.cantidad ?? 1;
          // por unidad, malla o bolsa, pero la línea dice cuánto pesa cada una: se usa ese peso
          const escrita = ['und', 'empaque'].includes(u.unidad) ? cantidadEscrita(x.presentacion) ?? cantidadEscrita(x.descripcion) : null;
          if (escrita && (!p || (p.unidad_base === 'g') === ['kg', 'g'].includes(escrita.unidad))) { c = c * escrita.n; u = { unidad: escrita.unidad, factor: 1 }; }
          return { n: i + 1, descripcion: x.descripcion, leida: x, producto_id: sugerido, buscar: '', peso: '',
                   cantidad: String(Math.round(c * u.factor * 1000) / 1000), unidad: u.unidad,
                   valor: x.valor_total != null ? String(x.valor_total) : x.precio_unitario != null ? String(x.precio_unitario * c) : '',
                   fijar: true, ignorar: false, corregir: false, pres: presDe(p, x), ren: renDe(p, x), nuevo: null, resultado: null };
        });
        cambiarFoto(id, (x) => ({ ...x, estado: 'listo', tipo: l.tipo_documento, notas: l.notas, proveedor: l.proveedor ?? '',
                                  proveedor_id: r.proveedor_id ?? '', sugeridos: r.proveedor_sugeridos, del_proveedor: r.del_proveedor, proveedor_razon: r.proveedor_razon,
                                  documento: l.documento ?? '', fecha: l.fecha ?? '', lineas,
                                  error: l.legible ? (lineas.length ? null : 'No se encontraron precios en esta foto.') : 'La foto no se puede leer o no muestra precios.' }));
      } catch (e) {
        cambiarFoto(id, (x) => ({ ...x, estado: 'error', error: e instanceof Error ? e.message : String(e) }));
      }
    }
  }

  async function crear(f: Foto, l: Linea) {
    const nv = l.nuevo;
    if (!nv) return;
    const genExistente = nv.modo === 'presentacion' ? productos.find((x) => x.producto_id === nv.generico_id) : undefined;
    if (nv.modo === 'presentacion' && !genExistente) { cambiarLinea(f.id, l.n, (x) => ({ ...x, nuevo: { ...nv, error: 'Elige de qué producto es la presentación.' } })); return; }
    const ub = genExistente?.unidad_base ?? nv.unidad_base;
    const cont = nv.variable ? null : numero(nv.contenido);
    if (!nv.variable && !(cont && cont > 0)) { cambiarLinea(f.id, l.n, (x) => ({ ...x, nuevo: { ...nv, error: `Di cuánto trae 1 ${nv.unidad_compra || 'unidad'} en ${ub}, o marca «se pesa al recibir».` } })); return; }
    cambiarLinea(f.id, l.n, (x) => ({ ...x, nuevo: { ...nv, enviando: true, error: null } }));
    const r = await crearDesdeFoto(area, {
      hermano: genExistente?.producto_id ?? null, nombre: nv.nombre, tipo: nv.tipo, unidad_base: ub, categoria: nv.categoria || null, marca: nv.marca,
      presentacion: nv.presentacion, unidad_compra: nv.unidad_compra, contenido_base: cont, contenido_variable: nv.variable,
      motivo: nv.motivo || null, factura: l.descripcion,
    });
    if (!r.ok) {
      cambiarLinea(f.id, l.n, (x) => ({ ...x, nuevo: { ...nv, enviando: false, bloqueos: r.bloqueos, error: r.fatales.join(' ') || (r.bloqueos.length ? null : 'No se pudo crear.') } }));
      return;
    }
    const cat = categorias.find((c) => c.codigo === nv.categoria);
    const creado: ProductoPrecio = {
      producto_id: r.producto_id, codigo: '(nuevo)', generico: genExistente?.generico ?? nv.nombre.trim(), marca: nv.marca.trim(),
      presentacion: nv.presentacion.trim(), categoria: cat?.nombre ?? genExistente?.categoria ?? 'Sin categoría', unidad_base: ub,
      unidad_compra: nv.unidad_compra.trim().toUpperCase(), contenido_base: cont, contenido_variable: nv.variable,
      costo_promedio: null, area, costo_ref: null, peso_und: null,
    };
    setProductos((xs) => [...xs, creado]);
    cambiarLinea(f.id, l.n, (x) => ({ ...x, nuevo: null, producto_id: creado.producto_id, buscar: '', pres: presDe(creado, x.leida),
                                      ren: renDe(creado, x.leida), unidad: unidadLeida(x.leida.unidad, creado).unidad,
                                      resultado: { ok: true, mensaje: ['Agregado al catálogo (queda provisional hasta validarlo).', ...r.avisos].join(' ') } }));
  }

  async function guardar(f: Foto) {
    if (!f.ruta) return;
    const sinTerminar = new Map<number, string>();
    const lineas = f.lineas.filter((l) => !l.ignorar).flatMap((l) => {
      const p = l.producto_id ? porId.get(l.producto_id) : undefined;
      const { base, problema } = aBase(l, p);
      const valor = numero(l.valor);
      if (!p || base == null || !(valor > 0)) { sinTerminar.set(l.n, problema ?? 'Falta el valor.'); return []; }
      const peso_unidad = l.unidad === 'und' && p.unidad_base !== 'und' && l.peso.trim() ? numero(l.peso) : undefined;
      const presentacion = l.corregir ? {
        presentacion: l.pres.presentacion.trim(), unidad_compra: l.pres.unidad_compra.trim().toUpperCase(),
        contenido_variable: l.pres.variable, contenido_base: l.pres.variable ? null : numero(l.pres.contenido),
      } : undefined;
      const renombrar = l.ren.cambiarNombre || l.ren.cambiarMarca ? {
        ...(l.ren.cambiarNombre && l.ren.nombre.trim() ? { nombre: l.ren.nombre.trim() } : {}),
        ...(l.ren.cambiarMarca ? { marca: l.ren.marca.trim() } : {}),
      } : undefined;
      return [{ n: l.n, producto_id: p.producto_id, descripcion: l.descripcion, cantidad_base: base, valor_total: valor, fijar_costo: l.fijar,
                presentacion, renombrar, peso_unidad }];
    });
    const marcarSinTerminar = (x: Foto): Foto => ({ ...x, lineas: x.lineas.map((l) => (sinTerminar.has(l.n)
      ? { ...l, resultado: { ok: false, mensaje: `No se guardó: ${sinTerminar.get(l.n)}` } } : l)) });
    if (!lineas.length) {
      cambiarFoto(f.id, (x) => ({ ...marcarSinTerminar(x), error: 'No hay líneas listas para guardar: revisa las marcadas en rojo.' }));
      return;
    }
    setGuardando(f.id);
    const r = await guardarPrecios({ area, ruta: f.ruta, proveedor_id: f.proveedor_id || null, proveedor: f.proveedor || null,
                                     documento: f.documento || null, fecha: f.fecha || null, lineas });
    setGuardando(null);
    if ('error' in r) { cambiarFoto(f.id, (x) => ({ ...x, error: r.error })); return; }
    const pendientes = r.fallidos + sinTerminar.size;
    cambiarFoto(f.id, (x) => ({
      ...marcarSinTerminar(x),
      error: pendientes ? `${r.ok} guardada(s); ${pendientes} sin guardar: corrige las marcadas en rojo y vuelve a guardar.` : null,
      estado: pendientes ? 'listo' : 'guardado',
      lineas: marcarSinTerminar(x).lineas.map((l) => { const d = r.detalle.find((y) => y.n === l.n); return d ? { ...l, resultado: { ok: d.ok, mensaje: d.mensaje } } : l; }),
    }));
    router.refresh();
  }

  return (
    <>
      <div className="tarjeta pagina-ancha" style={{ display: 'grid', gap: '.6rem' }}>
        {areas.length > 1 && (
          <label style={{ margin: 0 }}>Área
            <select value={area} onChange={(e) => setArea(e.target.value as Area)} disabled={fotos.some((f) => f.estado === 'subiendo' || f.estado === 'leyendo')}>
              {areas.map((a) => <option key={a} value={a}>{a === 'BAR' ? 'Bar' : 'Cocina'}</option>)}
            </select>
          </label>
        )}
        <label className="boton" style={{ margin: 0, textAlign: 'center', cursor: 'pointer' }}>
          📷 Tomar o subir fotos
          <input type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }}
                 onChange={(e) => { subir(e.target.files); e.target.value = ''; }} />
        </label>
        <span className="suave" style={{ fontSize: '.85rem' }}>
          Puedes subir varias a la vez. Cada foto se lee aparte; nada se guarda hasta que tocas «Guardar precios».
        </span>
      </div>

      {fotos.map((f) => (
        <section key={f.id} className="tarjeta pagina-ancha" style={{ marginTop: '.8rem' }}>
          <div style={{ display: 'flex', gap: '.8rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {f.vista && <a href={f.vista} target="_blank" rel="noreferrer"><img src={f.vista} alt="Foto" style={{ width: 90, borderRadius: 6 }} /></a>}
            <div style={{ flex: 1, minWidth: 220 }}>
              {f.estado === 'subiendo' && <p>Subiendo la foto…</p>}
              {f.estado === 'leyendo' && <p>La IA está leyendo los precios… (puede tardar un minuto)</p>}
              {f.estado === 'guardado' && <p className="exito" role="status">Precios guardados.</p>}
              {f.error && <p className="aviso" role="status">{f.error}</p>}
              {(f.estado === 'listo' || f.estado === 'guardado') && (
                <div className="fila">
                  <label style={{ margin: 0 }}>Proveedor
                    <select value={f.proveedor_id} onChange={(e) => cambiarFoto(f.id, (x) => ({ ...x, proveedor_id: e.target.value }))}>
                      <option value="">{f.proveedor ? `No está en la lista («${f.proveedor}»)` : '— sin proveedor —'}</option>
                      {f.sugeridos.length > 0 && <optgroup label="Parecidos al de la foto">
                        {f.sugeridos.map((id) => <option key={id} value={id}>{proveedores.find((x) => x.id === id)?.nombre}</option>)}
                      </optgroup>}
                      <optgroup label="Todos">{proveedores.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</optgroup>
                    </select>
                    {f.proveedor_razon && <span className="ayuda">{f.proveedor_razon}{f.proveedor ? ` (en la foto: «${f.proveedor}»)` : ''}</span>}
                    {!f.proveedor_id && f.proveedor && <span className="ayuda">Se guarda con el nombre de la foto. Para que quede en la lista, créalo en Recibir o pídeselo a administración.</span>}
                  </label>
                  <label style={{ margin: 0 }}>Fecha<input type="date" value={f.fecha} onChange={(e) => cambiarFoto(f.id, (x) => ({ ...x, fecha: e.target.value }))} /></label>
                  <label style={{ margin: 0 }}>N° documento<input value={f.documento} onChange={(e) => cambiarFoto(f.id, (x) => ({ ...x, documento: e.target.value }))} /></label>
                </div>
              )}
              {f.notas && <p className="suave" style={{ fontSize: '.85rem' }}>La IA dice: {f.notas}</p>}
            </div>
          </div>

          {f.lineas.map((l) => {
            const p = l.producto_id ? porId.get(l.producto_id) : undefined;
            const { base, problema } = aBase(l, p);
            const valor = numero(l.valor);
            const cu = base && valor > 0 ? valor / base : null;
            const [min, max] = p ? COSTO_CREIBLE[p.unidad_base] : [0, Infinity];
            const raro = cu != null && (cu < min || cu > max);
            const actual = p?.costo_ref ?? p?.costo_promedio ?? null;
            const cambio = cu != null && actual ? (cu - actual) / actual : null;
            const opciones = [...new Set([l.producto_id, l.leida.sugerencia_ia?.producto_id, ...l.leida.candidatos.map((c) => c.producto_id)].filter(Boolean) as string[])];
            const encontrados = l.buscar.trim().length >= 2
              ? delArea.filter((x) => normal(`${x.generico} ${x.marca} ${x.presentacion} ${x.codigo}`).includes(normal(l.buscar))).slice(0, 8) : [];
            const nombre = (x: ProductoPrecio) => [x.generico, x.marca, x.presentacion].filter(Boolean).join(' · ');
            return (
              <div key={l.n} style={{ borderTop: '1px solid var(--borde)', padding: '.6rem 0', opacity: l.ignorar ? 0.5 : 1, display: 'grid', gap: '.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
                  <span><span className="suave">{l.n}.</span> <strong>«{l.descripcion}»</strong>
                    {l.leida.presentacion && <span className="suave"> · {l.leida.presentacion}</span>}</span>
                  <label style={{ margin: 0, display: 'flex', gap: '.3rem', alignItems: 'center', fontWeight: 400 }}>
                    <input type="checkbox" checked={l.ignorar} style={{ width: 18, minHeight: 18 }}
                           onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, ignorar: e.target.checked }))} />No guardar esta
                  </label>
                </div>
                {!l.ignorar && (
                  <>
                    <label style={{ margin: 0 }}>Producto del catálogo
                      <select value={l.producto_id ?? ''} onChange={(e) => elegir(f.id, l.n, e.target.value || null)}>
                        <option value="">— elige —</option>
                        {opciones.map((id) => { const x = porId.get(id); return x ? <option key={id} value={id}>{nombre(x)}</option> : null; })}
                      </select>
                    </label>
                    {l.leida.sugerencia_ia?.razon && <span className="suave" style={{ fontSize: '.8rem' }}>IA: {l.leida.sugerencia_ia.razon}</span>}
                    {p && f.del_proveedor.includes(p.producto_id) && <span style={{ fontSize: '.8rem', color: 'var(--ok)' }}>✓ Ya se le compra este producto a este proveedor.</span>}
                    {p && (() => {
                      const otroNombre = l.leida.nombre_generico && normal(l.leida.nombre_generico) !== normal(p.generico);
                      const otraMarca = l.leida.marca && normal(l.leida.marca) !== normal(p.marca);
                      if (!otroNombre && !otraMarca && !l.ren.cambiarNombre && !l.ren.cambiarMarca) return null;
                      return (
                        <div className="tarjeta" style={{ display: 'grid', gap: '.35rem', padding: '.5rem' }}>
                          <span style={{ fontSize: '.85rem' }}>Según la factura, la IA sugiere:</span>
                          {(otroNombre || l.ren.cambiarNombre) && (
                            <label style={{ margin: 0, display: 'flex', gap: '.4rem', alignItems: 'center', fontWeight: 400, flexWrap: 'wrap' }}>
                              <input type="checkbox" checked={l.ren.cambiarNombre} style={{ width: 18, minHeight: 18 }}
                                     onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, ren: { ...x.ren, cambiarNombre: e.target.checked } }))} />
                              Cambiar el nombre «{p.generico}» a
                              <input value={l.ren.nombre} style={{ flex: 1, minWidth: 140 }} disabled={!l.ren.cambiarNombre}
                                     onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, ren: { ...x.ren, nombre: e.target.value } }))} />
                            </label>
                          )}
                          {(otraMarca || l.ren.cambiarMarca) && (
                            <label style={{ margin: 0, display: 'flex', gap: '.4rem', alignItems: 'center', fontWeight: 400, flexWrap: 'wrap' }}>
                              <input type="checkbox" checked={l.ren.cambiarMarca} style={{ width: 18, minHeight: 18 }}
                                     onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, ren: { ...x.ren, cambiarMarca: e.target.checked } }))} />
                              {p.marca ? <>Cambiar la marca «{p.marca}» a</> : <>Ponerle marca</>}
                              <input value={l.ren.marca} style={{ flex: 1, minWidth: 140 }} disabled={!l.ren.cambiarMarca}
                                     onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, ren: { ...x.ren, marca: e.target.value } }))} />
                            </label>
                          )}
                          <span className="suave" style={{ fontSize: '.78rem' }}>El nombre aplica a todas las presentaciones del genérico; la marca, solo a esta.</span>
                        </div>
                      );
                    })()}
                    <input placeholder="¿No está? Busca otro producto…" value={l.buscar}
                           onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, buscar: e.target.value }))} />
                    {!l.nuevo && (
                      <button type="button" className={!l.producto_id || (!l.leida.candidatos.length && !l.leida.sugerencia_ia?.producto_id) ? 'mini' : 'secundario mini'}
                              style={{ justifySelf: 'start' }} onClick={() => cambiarLinea(f.id, l.n, (x) => ({ ...x, nuevo: nuevoDesde(x.leida) }))}>
                        ➕ No está: agregarlo al catálogo
                      </button>
                    )}
                    {l.nuevo && (() => {
                      const nv = l.nuevo;
                      const set = (c: Partial<Nuevo>) => cambiarLinea(f.id, l.n, (x) => ({ ...x, nuevo: x.nuevo ? { ...x.nuevo, ...c } : x.nuevo }));
                      const genSel = nv.modo === 'presentacion' ? porId.get(nv.generico_id) : undefined;
                      const ub = genSel?.unidad_base ?? nv.unidad_base;
                      const busca = nv.modo === 'presentacion' && !genSel && nv.nombre.trim().length >= 2
                        ? delArea.filter((x) => normal(x.generico).includes(normal(nv.nombre))).slice(0, 8) : [];
                      return (
                        <div className="tarjeta" style={{ display: 'grid', gap: '.4rem' }}>
                          <strong>Agregar al catálogo</strong>
                          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            {(['nuevo', 'presentacion'] as const).map((m) => (
                              <label key={m} style={{ margin: 0, display: 'flex', gap: '.3rem', alignItems: 'center', fontWeight: 400 }}>
                                <input type="radio" checked={nv.modo === m} style={{ width: 18, minHeight: 18 }} onChange={() => set({ modo: m, generico_id: '' })} />
                                {m === 'nuevo' ? 'Producto nuevo' : 'Otra marca o presentación de uno que ya existe'}
                              </label>
                            ))}
                          </div>
                          {nv.modo === 'presentacion' ? (
                            <>
                              {genSel ? (
                                <span>De: <strong>{genSel.generico}</strong> ({genSel.unidad_base}) <button type="button" className="secundario mini" onClick={() => set({ generico_id: '' })}>cambiar</button></span>
                              ) : (
                                <label style={{ margin: 0 }}>¿De qué producto es? <input value={nv.nombre} onChange={(e) => set({ nombre: e.target.value })} placeholder="Escribe para buscar…" /></label>
                              )}
                              {busca.length > 0 && (
                                <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                                  {[...new Map(busca.map((x) => [x.generico, x])).values()].map((x) => (
                                    <button key={x.producto_id} type="button" className="secundario mini" onClick={() => set({ generico_id: x.producto_id })}>{x.generico}</button>
                                  ))}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="fila">
                              <label style={{ margin: 0 }}>Nombre genérico <span className="ayuda">sin marca ni tamaño</span>
                                <input value={nv.nombre} onChange={(e) => set({ nombre: e.target.value })} />
                              </label>
                              <label style={{ margin: 0 }}>Tipo
                                <select value={nv.tipo} onChange={(e) => set({ tipo: e.target.value as TipoInsumo })}>
                                  {TIPOS_INSUMO.filter((t) => t.v !== 'MPI').map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}
                                </select>
                              </label>
                              <label style={{ margin: 0 }}>Unidad base
                                <select value={nv.unidad_base} onChange={(e) => set({ unidad_base: e.target.value as Nuevo['unidad_base'] })}>
                                  <option value="g">gramos (g)</option><option value="ml">mililitros (ml)</option><option value="und">unidades (und)</option>
                                </select>
                              </label>
                              {nv.tipo === 'MPe' && (
                                <label style={{ margin: 0 }}>Categoría
                                  <select value={nv.categoria} onChange={(e) => set({ categoria: e.target.value })}>
                                    <option value="">— sin categoría —</option>
                                    {categorias.filter((c) => c.area === area).map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                                  </select>
                                </label>
                              )}
                            </div>
                          )}
                          <div className="fila">
                            <label style={{ margin: 0 }}>Marca <input value={nv.marca} onChange={(e) => set({ marca: e.target.value })} /></label>
                            <label style={{ margin: 0 }}>Presentación <input value={nv.presentacion} placeholder="Bolsa 1.000 g, Granel…" onChange={(e) => set({ presentacion: e.target.value })} /></label>
                            <label style={{ margin: 0 }}>Se compra por <input value={nv.unidad_compra} placeholder="BOLSA, BOT, KG…" onChange={(e) => set({ unidad_compra: e.target.value })} /></label>
                            {!nv.variable && (
                              <label style={{ margin: 0 }}>Trae ({ub}) <input inputMode="decimal" value={nv.contenido} onChange={(e) => set({ contenido: e.target.value })} /></label>
                            )}
                          </div>
                          <label style={{ margin: 0, display: 'flex', gap: '.3rem', alignItems: 'center', fontWeight: 400 }}>
                            <input type="checkbox" checked={nv.variable} style={{ width: 18, minHeight: 18 }} onChange={(e) => set({ variable: e.target.checked })} />
                            Se pesa al recibir (contenido variable)
                          </label>
                          {nv.bloqueos.length > 0 && (
                            <div className="aviso">
                              {nv.bloqueos.map((b) => <div key={b}>{b}</div>)}
                              <label style={{ margin: '.3rem 0 0' }}>Si de verdad es otro producto, di por qué
                                <input value={nv.motivo} onChange={(e) => set({ motivo: e.target.value })} placeholder="No es el mismo porque…" />
                              </label>
                            </div>
                          )}
                          {nv.error && <div className="aviso">{nv.error}</div>}
                          <div style={{ display: 'flex', gap: '.4rem' }}>
                            <button type="button" disabled={nv.enviando} onClick={() => crear(f, l)}>{nv.enviando ? 'Creando…' : 'Crear y usar en esta línea'}</button>
                            <button type="button" className="secundario" onClick={() => cambiarLinea(f.id, l.n, (x) => ({ ...x, nuevo: null }))}>Cancelar</button>
                          </div>
                        </div>
                      );
                    })()}
                    {encontrados.length > 0 && (
                      <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                        {encontrados.map((x) => <button key={x.producto_id} type="button" className="secundario mini" onClick={() => elegir(f.id, l.n, x.producto_id)}>{nombre(x)}</button>)}
                      </div>
                    )}
                    <div className="fila">
                      <label style={{ margin: 0 }}>Cantidad
                        <input inputMode="decimal" value={l.cantidad} onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, cantidad: e.target.value }))} />
                      </label>
                      <label style={{ margin: 0 }}>Unidad
                        <select value={l.unidad} onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, unidad: e.target.value as Unidad }))}>
                          {UNIDADES.map((u) => <option key={u.v} value={u.v}>{u.v === 'empaque' && p ? `${p.unidad_compra} (${p.contenido_variable ? 'variable' : `${cant(p.contenido_base)} ${p.unidad_base}`})` : u.t}</option>)}
                        </select>
                      </label>
                      <label style={{ margin: 0 }}>Valor total ($)
                        <input inputMode="decimal" value={l.valor} onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, valor: e.target.value }))} />
                      </label>
                    </div>
                    {p && l.unidad === 'und' && p.unidad_base !== 'und' && (
                      <label style={{ margin: 0 }}>Cada unidad pesa aprox. ({p.unidad_base})
                        <input inputMode="decimal" value={l.peso} placeholder={p.peso_und ? String(p.peso_und) : 'Ej.: 1200'}
                               onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, peso: e.target.value }))} />
                        <span className="ayuda">{p.peso_und && !l.peso.trim() ? `Se usa el que ya se sabe: ${cant(p.peso_und)} ${p.unidad_base}.` : 'Queda guardado para la próxima vez.'}</span>
                      </label>
                    )}
                    <div style={{ fontSize: '.88rem' }}>
                      {problema ? <span style={{ color: 'var(--error)' }}>{problema}</span> : cu != null && p && (
                        <>
                          = {cant(base)} {p.unidad_base} · <strong>{pesos(cu)} por {p.unidad_base}</strong>
                          {!p.contenido_variable && p.contenido_base ? <> · 1 {p.unidad_compra} = {pesos(cu * Number(p.contenido_base))}</> : null}
                          {actual != null && <span className="suave"> · antes {pesos(actual)} por {p.unidad_base}{cambio != null && ` (${cambio >= 0 ? '+' : ''}${Math.round(cambio * 100)} %)`}</span>}
                          {raro && <div style={{ color: 'var(--error)' }}>Ese costo no es creíble: revisa la cantidad y su unidad.</div>}
                          {cambio != null && Math.abs(cambio) > 0.5 && !raro && <div style={{ color: 'var(--aviso)' }}>Cambia más del 50 % frente al costo que tenía: revisa que sea la misma presentación.</div>}
                        </>
                      )}
                    </div>
                    {p && (
                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <label style={{ margin: 0, display: 'flex', gap: '.3rem', alignItems: 'center', fontWeight: 400 }}>
                          <input type="checkbox" checked={l.fijar} style={{ width: 18, minHeight: 18 }}
                                 onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, fijar: e.target.checked }))} />
                          Usar como costo del producto
                        </label>
                        <label style={{ margin: 0, display: 'flex', gap: '.3rem', alignItems: 'center', fontWeight: 400 }}>
                          <input type="checkbox" checked={l.corregir} style={{ width: 18, minHeight: 18 }}
                                 onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, corregir: e.target.checked }))} />
                          Corregir su presentación
                        </label>
                      </div>
                    )}
                    {p && l.corregir && (
                      <div className="fila">
                        <label style={{ margin: 0 }}>Presentación
                          <input value={l.pres.presentacion} placeholder="Bolsa 1.000 g" onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, pres: { ...x.pres, presentacion: e.target.value } }))} />
                        </label>
                        <label style={{ margin: 0 }}>Se compra por
                          <input value={l.pres.unidad_compra} placeholder="BOLSA, CJA, KG…" onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, pres: { ...x.pres, unidad_compra: e.target.value } }))} />
                        </label>
                        {!l.pres.variable && (
                          <label style={{ margin: 0 }}>Trae ({p.unidad_base})
                            <input inputMode="decimal" value={l.pres.contenido} onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, pres: { ...x.pres, contenido: e.target.value } }))} />
                          </label>
                        )}
                        <label style={{ margin: 0, display: 'flex', gap: '.3rem', alignItems: 'center', fontWeight: 400 }}>
                          <input type="checkbox" checked={l.pres.variable} style={{ width: 18, minHeight: 18 }}
                                 onChange={(e) => cambiarLinea(f.id, l.n, (x) => ({ ...x, pres: { ...x.pres, variable: e.target.checked } }))} />
                          Se pesa al recibir
                        </label>
                      </div>
                    )}
                    {l.resultado && <span style={{ fontSize: '.85rem', color: l.resultado.ok ? 'var(--ok)' : 'var(--error)' }}>{l.resultado.ok ? '✓ ' : ''}{l.resultado.mensaje}</span>}
                  </>
                )}
              </div>
            );
          })}

          {f.estado === 'listo' && f.lineas.length > 0 && (
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
              <button type="button" disabled={guardando === f.id} onClick={() => guardar(f)}>
                {guardando === f.id ? 'Guardando…' : `Guardar precios (${f.lineas.filter((l) => !l.ignorar && !aBase(l, l.producto_id ? porId.get(l.producto_id) : undefined).problema && numero(l.valor) > 0).length})`}
              </button>
              {(() => {
                const n = f.lineas.filter((l) => !l.ignorar && (aBase(l, l.producto_id ? porId.get(l.producto_id) : undefined).problema || !(numero(l.valor) > 0))).length;
                return n ? <span style={{ color: 'var(--error)', alignSelf: 'center', fontSize: '.88rem' }}>{n} línea(s) sin terminar: no se guardarán hasta corregirlas o marcar «No guardar esta».</span> : null;
              })()}
              <button type="button" className="secundario" onClick={() => setFotos((xs) => xs.filter((x) => x.id !== f.id))}>Descartar esta foto</button>
            </div>
          )}
        </section>
      ))}

      {fotos.some((f) => f.estado === 'guardado') && (
        <p className="pagina-ancha" style={{ marginTop: '.8rem' }}><Link href="/catalogo/verificar">Ver los precios en la hoja de verificación →</Link></p>
      )}
    </>
  );
}
