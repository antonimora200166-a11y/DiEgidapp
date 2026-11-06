// Fuentes de propuestas de fichas (supabase/migrations/20261107210000): de dónde vienen, qué validan y cómo se llaman en pantalla.
export type ClaveFuente = 'cocina' | 'cocteles';
export const FUENTES: Record<ClaveFuente, {
  fuente: string; area: 'BAR' | 'COCINA'; titulo: string; resultado: string; resultados: string; receta: string; recetas: string;
  conIngredientes: boolean; volver: { href: string; texto: string };
}> = {
  cocina: { fuente: 'RECETARIO COCINA', area: 'COCINA', titulo: 'Validar MPI de cocina con el recetario', resultado: 'MPI', resultados: 'MPI',
            receta: 'receta', recetas: 'Recetas sin MPI', conIngredientes: true, volver: { href: '/produccion?area=COCINA', texto: 'Fichas de cocina' } },
  cocteles: { fuente: 'CARTA COCTELERÍA', area: 'BAR', titulo: 'Completar las fichas de cócteles con la carta', resultado: 'bebida', resultados: 'Bebidas',
              receta: 'cóctel', recetas: 'Cócteles de la carta', conIngredientes: false, volver: { href: '/fichas', texto: 'Fichas técnicas' } },
};
export const claveFuente = (v?: string | null): ClaveFuente => (v === 'cocteles' ? 'cocteles' : 'cocina');
