'use client';
import { useCallback, useState } from 'react';

// Clave de envío del formulario y productos confirmados tras una revisión (public.enviar).
// La clave nace al abrir el formulario y se renueva al empezar otro documento: un doble toque
// o un reenvío por red lenta llegan con la misma clave y la base no registra dos veces.
export function useEnvio() {
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const [confirmados, setConfirmados] = useState<string[]>([]);
  const nuevo = useCallback(() => { setClave(crypto.randomUUID()); setConfirmados([]); }, []);
  return { clave, confirmados, setConfirmados, nuevo };
}
