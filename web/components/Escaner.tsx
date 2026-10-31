'use client';
import { useEffect, useRef, useState } from 'react';
import Icono from './Icono';

// Lector de códigos con la cámara (BarcodeDetector: Chrome en Android y PC). Lee QR de etiquetas
// de lote y códigos de barras (EAN, UPC, Code 128). Sin cámara o en un navegador que no lo trae
// (iPhone), queda el campo de texto: ahí también escribe un lector USB o Bluetooth.
type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
const FORMATOS = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];

export default function Escaner({ onCodigo, onCerrar, titulo = 'Escanear', continuo = false }: {
  onCodigo: (texto: string) => void; onCerrar: () => void; titulo?: string; continuo?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const [estado, setEstado] = useState<'iniciando' | 'leyendo' | 'sin-camara'>('iniciando');
  const [manual, setManual] = useState('');
  const [ultimo, setUltimo] = useState<string | null>(null);
  const cb = useRef(onCodigo);
  cb.current = onCodigo;

  useEffect(() => {
    dialogo.current?.showModal();
    let flujo: MediaStream | null = null;
    let vivo = true;
    let visto = { texto: '', cuando: 0 };
    const w = window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector };
    (async () => {
      if (!w.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) { setEstado('sin-camara'); return; }
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!vivo || !video.current) return;
        video.current.srcObject = flujo;
        await video.current.play();
        setEstado('leyendo');
        const det = new w.BarcodeDetector({ formats: FORMATOS });
        const ciclo = async () => {
          if (!vivo || !video.current) return;
          try {
            const r = await det.detect(video.current);
            const t = r[0]?.rawValue?.trim();
            // el mismo código se ignora 2,5 s: una botella frente a la cámara no cuenta diez veces
            if (t && (t !== visto.texto || Date.now() - visto.cuando > 2500)) {
              visto = { texto: t, cuando: Date.now() };
              navigator.vibrate?.(60);
              setUltimo(t);
              cb.current(t);
              if (!continuo) return;
            }
          } catch { /* cuadro sin leer */ }
          setTimeout(ciclo, 180);
        };
        ciclo();
      } catch { setEstado('sin-camara'); }
    })();
    return () => { vivo = false; flujo?.getTracks().forEach((t) => t.stop()); };
  }, [continuo]);

  return (
    <dialog ref={dialogo} className="dialogo escaner" onCancel={(e) => { e.preventDefault(); onCerrar(); }}>
      <h2 style={{ margin: '0 0 .6rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}><Icono nombre="escanear" /> {titulo}</h2>
      {estado !== 'sin-camara' ? (
        <div className="escaner-visor">
          <video ref={video} playsInline muted />
          <div className="escaner-marco" aria-hidden />
          {estado === 'iniciando' && <span className="suave">Abriendo la cámara…</span>}
        </div>
      ) : (
        <p className="aviso" style={{ marginTop: 0 }}>Este navegador no lee códigos con la cámara. Escribe el número o usa un lector conectado.</p>
      )}
      {ultimo && <p className="exito" style={{ margin: '.6rem 0 0', padding: '.4rem .6rem' }}>Leído: <span className="cod">{ultimo}</span></p>}
      <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { cb.current(manual.trim()); setUltimo(manual.trim()); setManual(''); } }}
            style={{ display: 'flex', gap: '.5rem', marginTop: '.7rem' }}>
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="o escribe el código" aria-label="Código"
               autoFocus={estado === 'sin-camara'} inputMode="text" />
        <button type="submit" className="secundario">Buscar</button>
      </form>
      <div className="acciones" style={{ justifyContent: 'flex-end', marginTop: '.8rem' }}>
        <button type="button" onClick={onCerrar}>{continuo ? 'Listo' : 'Cerrar'}</button>
      </div>
    </dialog>
  );
}
