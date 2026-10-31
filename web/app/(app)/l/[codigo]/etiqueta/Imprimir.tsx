'use client';
import Icono from '@/components/Icono';

export default function Imprimir() {
  return <button type="button" className="chico" onClick={() => window.print()}><Icono nombre="qr" /> Imprimir</button>;
}
