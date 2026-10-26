'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { reportarError } from '@/lib/reportar';

// Lo que ve una persona cuando una pantalla falla. El error ya quedó registrado para administración.
export default function ErrorPantalla({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportarError(error, error.digest); }, [error]);
  return (
    <div className="tarjeta">
      <h1>Algo falló en esta pantalla</h1>
      <p>No se perdió nada de lo que ya estaba guardado. El error quedó registrado y administración lo puede revisar.</p>
      <p className="suave" style={{ fontSize: '.88rem' }}>
        Si estabas guardando algo, revisa si quedó antes de repetirlo.{error.digest && <> Código: <span className="cod">{error.digest}</span></>}
      </p>
      <div className="acciones">
        <button type="button" onClick={reset}>Intentar de nuevo</button>
        <Link className="boton secundario" href="/">Ir al inicio</Link>
      </div>
    </div>
  );
}
