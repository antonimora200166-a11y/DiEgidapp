import { redirect } from 'next/navigation';

// La pantalla de proveedores ahora es propia: /proveedores (los enlaces viejos llegan allá).
export default function ProveedoresViejo() {
  redirect('/proveedores');
}
