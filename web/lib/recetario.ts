// Fuentes de propuestas de fichas (supabase/migrations/20261107210000 y 20261108090000): de dónde vienen, qué validan y cómo se llaman en pantalla.
// conIngredientes: tiene el paso 1 (emparejar ingredientes del recetario).
// lineasDeReceta: la ficha toma los ingredientes de la receta (cocina y platos); si no, conserva los de la ficha ya costeada (cócteles).
export type ClaveFuente = 'cocina' | 'platos' | 'cocteles';
export const FUENTES: Record<ClaveFuente, {
  fuente: string; area: 'BAR' | 'COCINA'; titulo: string; resultado: string; resultados: string; receta: string; recetas: string;
  conIngredientes: boolean; lineasDeReceta: boolean; volver: { href: string; texto: string };
}> = {
  cocina: { fuente: 'RECETARIO COCINA', area: 'COCINA', titulo: 'Validar MPI de cocina con el recetario', resultado: 'MPI', resultados: 'MPI',
            receta: 'receta', recetas: 'Recetas sin MPI', conIngredientes: true, lineasDeReceta: true,
            volver: { href: '/produccion?area=COCINA', texto: 'Fichas de cocina' } },
  platos: { fuente: 'CARTA COCINA', area: 'COCINA', titulo: 'Fichas de los platos de la carta', resultado: 'plato', resultados: 'Platos',
            receta: 'receta', recetas: 'Recetas de plato', conIngredientes: false, lineasDeReceta: true,
            volver: { href: '/fichas', texto: 'Fichas técnicas' } },
  cocteles: { fuente: 'CARTA COCTELERÍA', area: 'BAR', titulo: 'Completar las fichas de cócteles con la carta', resultado: 'bebida', resultados: 'Bebidas',
              receta: 'cóctel', recetas: 'Cócteles de la carta', conIngredientes: false, lineasDeReceta: false,
              volver: { href: '/fichas', texto: 'Fichas técnicas' } },
};
export const claveFuente = (v?: string | null): ClaveFuente => (v === 'cocteles' || v === 'platos' ? v : 'cocina');
// parámetro de la URL para no perder la fuente al navegar ('' para el recetario de cocina)
export const paramFuente = (c: ClaveFuente) => (c === 'cocina' ? '' : `fuente=${c}`);
