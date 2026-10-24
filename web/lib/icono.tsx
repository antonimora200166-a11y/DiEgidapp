import { ImageResponse } from 'next/og';

// Ícono PNG (Android exige PNG para instalar; iOS usa apple-icon). Mismo diseño que public/icon.svg,
// con margen para la máscara redonda de Android.
export function iconoPng(lado: number) {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: '#7a2e2a', color: '#f6f4ef', fontSize: lado * 0.5, fontWeight: 700, fontFamily: 'serif' }}>
        É
      </div>
    ),
    { width: lado, height: lado },
  );
}
