'use client';
import { useEffect, useState } from 'react';
import Icono from './Icono';

// Tema de la app, por equipo (localStorage): «claro», «oscuro» o «auto» (sigue al equipo).
// Si la persona nunca eligió, manda el tema por defecto de su rol: oscuro en la barra.
export type Tema = 'claro' | 'oscuro' | 'auto';
const CLAVE = 'tema';
const CLAVE_ROL = 'tema-rol';

function leer(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function guardar(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }

function vigente(): Tema {
  const t = leer(CLAVE) ?? leer(CLAVE_ROL);   // «auto» elegido a mano gana sobre el del rol
  return t === 'claro' || t === 'oscuro' ? t : 'auto';
}
function aplicar(t: Tema) {
  const r = document.documentElement;
  if (t === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t === 'oscuro' ? 'dark' : 'light');
}
const oscuroAhora = () => document.documentElement.getAttribute('data-theme') === 'dark'
  || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);

// El rol fija el tema por defecto del equipo (la barra trabaja con poca luz).
export function TemaDelRol({ oscuro }: { oscuro: boolean }) {
  useEffect(() => {
    if (oscuro) guardar(CLAVE_ROL, 'oscuro'); else { try { localStorage.removeItem(CLAVE_ROL); } catch { /* nada */ } }
    aplicar(vigente());
  }, [oscuro]);
  return null;
}

// Atajo en la cabecera: pasa de claro a oscuro y al revés.
export function BotonTema() {
  const [oscuro, setOscuro] = useState<boolean | null>(null);
  useEffect(() => { setOscuro(oscuroAhora()); }, []);
  return (
    <button type="button" className="boton-tema" aria-label={oscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            title={oscuro ? 'Tema claro' : 'Tema oscuro'}
            onClick={() => { const t: Tema = oscuroAhora() ? 'claro' : 'oscuro'; guardar(CLAVE, t); aplicar(t); setOscuro(t === 'oscuro'); }}>
      <Icono nombre="tema" />
    </button>
  );
}

// En Mi cuenta: las tres opciones.
export function SelectorTema() {
  const [t, setT] = useState<Tema | null>(null);
  useEffect(() => { setT(vigente()); }, []);
  const elegir = (v: Tema) => { guardar(CLAVE, v); aplicar(v); setT(v); };
  return (
    <div className="segmentos" role="radiogroup" aria-label="Tema de la app">
      {([['claro', 'Claro'], ['oscuro', 'Oscuro'], ['auto', 'Automático']] as const).map(([v, txt]) => (
        <label key={v}><input type="radio" name="tema" checked={t === v} onChange={() => elegir(v)} /><span>{txt}</span></label>
      ))}
    </div>
  );
}
