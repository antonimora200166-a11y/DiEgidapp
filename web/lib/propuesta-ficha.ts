// Propuesta de ficha desde el recetario o la carta: la misma para aprobar una por una (editor) o en grupo (como viene).
import type { DatosFicha, InicialFicha } from '@/app/(app)/fichas/[generico]/EditorFicha';
import type { Punto } from '@/lib/fichas';

export type LineaPropuesta = {
  tipo: 'ing' | 'sub'; codigo: string; cantidad: number | null; unidad: string | null; nombre: string | null; nota: string | null; estado: string | null;
  generico_id: string | null; generico: string | null; unidad_base: string | null;
};
export type Propuesta = {
  receta: { codigo: string; nombre: string; descripcion: string | null; rendimiento: number | null; unidad: string | null; alergenos: string[];
            procedimiento: string | null; estado: string; generico_id: string | null; ficha_id: string | null };
  propuesta: { pasos?: string[]; puntos?: (Punto & { de: string })[]; observaciones?: string[]; metodo?: string | null; presentacion?: string | null;
               decoracion?: string[]; concepto?: string | null; alergenos_declarados?: string[]; alergenos_sugeridos?: string[];
               suma_entrada_g?: number | null; suma_completa?: boolean } | null;
  lineas: LineaPropuesta[];
};

// conIngredientes: recetario de cocina (los ingredientes salen del recetario); si no, la carta (se dejan los de la ficha, ya costeados)
export function inicialDesdePropuesta(p: Propuesta, datos: DatosFicha, conIngredientes: boolean): InicialFicha {
  const r = p.receta;
  const pr = p.propuesta ?? {};
  const presentacion = [pr.presentacion, pr.decoracion?.length ? `Decoración: ${pr.decoracion.join(', ')}.` : null].filter(Boolean).join(' ');
  return {
    codigo: datos.ficha?.codigo ?? r.codigo,
    neto: conIngredientes ? (r.unidad === 'g' && r.rendimiento ? String(r.rendimiento) : '') : datos.ficha?.neto_esperado != null ? String(datos.ficha.neto_esperado) : '',
    tiempo: datos.ficha?.tiempo_min != null ? String(datos.ficha.tiempo_min) : '',
    porciones: conIngredientes ? (r.unidad === 'porciones' || r.unidad === 'und' ? String(r.rendimiento ?? '') : '') : datos.ficha?.porciones != null ? String(datos.ficha.porciones) : '',
    metodo: pr.metodo ?? datos.ficha?.metodo ?? '',
    pasos: pr.pasos ?? [],
    puntos: (pr.puntos ?? []).map((x) => ({ tipo: x.tipo, texto: x.texto })),
    alergenos: [...new Set([...(datos.ficha?.alergenos ?? []), ...(pr.alergenos_declarados ?? []), ...(pr.alergenos_sugeridos ?? [])])],
    descripcion: r.descripcion ?? datos.ficha?.descripcion ?? '',
    presentacion: presentacion || datos.ficha?.presentacion || '',
    observaciones: [datos.ficha?.observaciones, ...(pr.observaciones ?? [])].filter(Boolean).join(' '),
    lineas: conIngredientes
      ? p.lineas.filter((l) => l.generico_id).map((l) => ({ generico_id: l.generico_id!, cantidad: l.cantidad === null ? '' : String(l.cantidad),
          unidad: l.unidad === 'porciones' ? 'porcion' : l.unidad ?? l.unidad_base ?? 'g', nota: '' }))
      : datos.lineas.map((l) => ({ generico_id: l.generico_id, cantidad: l.cantidad === null ? '' : String(l.cantidad), unidad: l.unidad, nota: l.nota ?? '', producto_id: l.producto_id ?? '' })),
  };
}

// Lo mismo que envía el editor si se aprueba sin tocar nada (ver EditorFicha.guardar)
export function payloadSinCambios(datos: DatosFicha, ini: InicialFicha, motivo: string): Record<string, unknown> {
  const f = datos.ficha;
  return {
    generico_id: datos.resultado.id, codigo: ini.codigo, neto_esperado: ini.neto, nota: f?.nota ?? '', motivo_cambio: motivo,
    tiempo_min: ini.tiempo, porciones: ini.porciones, metodo: ini.metodo, empaque: f?.empaque ?? '',
    descripcion: ini.descripcion, presentacion: ini.presentacion ?? '', observaciones: ini.observaciones,
    procedimiento: ini.pasos.length ? ini.pasos : f?.procedimiento.length ? f.procedimiento : [''],
    alergenos: ini.alergenos, puntos: ini.puntos,
    almacenamientos: datos.almacenamientos.map((a) => ({ conservacion: a.conservacion, vida_util_dias: String(a.vida_util_dias), nota: a.nota ?? '' })),
    lineas: ini.lineas.map((l) => ({ generico_id: l.generico_id, cantidad: l.cantidad, unidad: l.unidad, nota: l.nota, producto_id: l.producto_id || null, factor: null })),
  };
}
