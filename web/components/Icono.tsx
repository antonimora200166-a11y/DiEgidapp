// Íconos de trazo (24×24) dibujados aquí: sin librerías, heredan el color del texto.
const TRAZOS: Record<string, string> = {
  inicio: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5',
  recibir: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9',
  producir: 'M9 3h6M10 3v5.5L4.8 18a2 2 0 0 0 1.8 3h10.8a2 2 0 0 0 1.8-3L14 8.5V3M7 14h10',
  trasladar: 'M4 8h13l-3.5-3.5M20 16H7l3.5 3.5',
  bajas: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  contar: 'M9 4h6v3H9zM7 5.5H5V21h14V5.5h-2M8.5 13l2.5 2.5 4.5-5',
  historial: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4.5h4.5M12 8v4.5l3 2',
  existencias: 'M12 3 3 7.5l9 4.5 9-4.5zM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5',
  fichas: 'M5 4h10l4 4v12H5zM15 4v4h4M8.5 12h7M8.5 16h7',
  catalogo: 'M4 5h16M4 10h16M4 15h10M4 20h7M17.5 19.5l3 3M15.5 17a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0',
  nuevo: 'M12 5v14M5 12h14',
  revision: 'M8 8h11v12H8zM5 16V4h11',
  arranque: 'M5 21V4M5 4h11l-2 4 2 4H5',
  usuarios: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6.5 6.5 0 0 1 3.5 6',
  registro: 'M3 12h4l3-7 4 14 3-7h4',
  cuenta: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  salir: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  mas: 'M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z',
};
export type NombreIcono = keyof typeof TRAZOS;

export default function Icono({ nombre, className = 'icono' }: { nombre: string; className?: string }) {
  const d = TRAZOS[nombre];
  if (!d) return null;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d={d} />
    </svg>
  );
}
