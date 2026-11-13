import { ImageResponse } from 'next/og';

// Ícono PNG (Android exige PNG para instalar; iOS usa apple-icon). Mismo diseño que public/icon.svg:
// monograma D·É en dorado sobre verde bosque, con margen para la máscara redonda de Android.
export function iconoPng(lado: number) {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0D3B33' }}>
        <div style={{ width: '78%', height: '78%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `${Math.max(2, lado * 0.012)}px solid #B08D57`,
                      borderRadius: lado * 0.12, color: '#C9A86F', fontSize: lado * 0.34, fontWeight: 600, fontFamily: 'serif' }}>
          D·É
        </div>
      </div>
    ),
    { width: lado, height: lado },
  );
}
