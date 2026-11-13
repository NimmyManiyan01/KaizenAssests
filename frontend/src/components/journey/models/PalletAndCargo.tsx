import { CanvasTexture, NearestFilter, SRGBColorSpace } from "three";

// Shared singleton QR canvas texture to eliminate GPU ReadPixels stalls
let sharedQrTexture: CanvasTexture | null = null;
export function getSharedQrTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  if (!sharedQrTexture) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = "#0f172a";
      // Position detection markers
      const marker = (x: number, y: number) => {
        ctx.fillRect(x, y, 28, 28);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x + 4, y + 4, 20, 20);
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(x + 8, y + 8, 12, 12);
      };
      marker(8, 8);
      marker(92, 8);
      marker(8, 92);
      // Synchronous industrial matrix barcode pattern
      for (let r = 0; r < 14; r++) {
        for (let c = 0; c < 14; c++) {
          if ((r * 11 + c * 17) % 3 === 0) {
            ctx.fillRect(40 + c * 3.5, 12 + r * 7, 3, 3);
          }
        }
      }
      sharedQrTexture = new CanvasTexture(canvas);
      sharedQrTexture.colorSpace = SRGBColorSpace;
      sharedQrTexture.magFilter = NearestFilter;
    }
  }
  return sharedQrTexture;
}

// These labels belong to the illustrative landing-page pallet, not stock records.
function BoxQrLabels({ bx, bz }: { bx: number; bz: number }) {
  const texture = getSharedQrTexture();
  if (!texture) return null;
  return (
    <>
      <mesh position={[0, 0.05, Math.sign(bz) * 0.272]} rotation={[0, bz > 0 ? 0 : Math.PI, 0]}>
        <planeGeometry args={[0.26, 0.26]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <mesh
        position={[Math.sign(bx) * 0.272, 0.05, 0]}
        rotation={[0, (Math.sign(bx) * Math.PI) / 2, 0]}
      >
        <planeGeometry args={[0.26, 0.26]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </>
  );
}

import { StaticBatch } from "../StaticBatch";

interface PalletAndCargoProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  hasCargo?: boolean;
  isWrapped?: boolean; // stretch wrap film for dispatch
  boxCount?: number;
  showQr?: boolean;
}

export function PalletAndCargo({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  hasCargo = true,
  isWrapped = false,
  boxCount = 8,
  showQr = true,
}: PalletAndCargoProps) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <StaticBatch>
      {/* ─── WOODEN PALLET ─── */}
      <group position={[0, 0.08, 0]}>
        {/* 3 Longitudinal Stringer Runners */}
        {[-0.5, 0, 0.5].map((sx, i) => (
          <mesh key={`stringer-${i}`} position={[sx, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.09, 0.12, 1.2]} />
            <meshStandardMaterial color="#854d0e" roughness={0.9} />
          </mesh>
        ))}

        {/* 5 Top Deck Slats */}
        {[-0.5, -0.25, 0, 0.25, 0.5].map((sz, i) => (
          <mesh key={`slat-${i}`} position={[0, 0.075, sz]} castShadow receiveShadow>
            <boxGeometry args={[1.2, 0.03, 0.16]} />
            <meshStandardMaterial color="#a16207" roughness={0.85} />
          </mesh>
        ))}
      </group>

      {/* ─── CARGO CARTONS ─── */}
      {hasCargo && (
        <group position={[0, 0.2, 0]}>
          {/* Layer 1: 4 Boxes */}
          {[
            [-0.28, 0.3, -0.28],
            [0.28, 0.3, -0.28],
            [-0.28, 0.3, 0.28],
            [0.28, 0.3, 0.28],
          ].map(([bx, by, bz], i) => (
            <group key={`b1-${i}`} position={[bx, by, bz]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[0.54, 0.58, 0.54]} />
                <meshStandardMaterial color="#b45309" roughness={0.8} />
              </mesh>
              {/* White Barcode Shipping Label */}
              {!showQr && (
                <mesh position={[0, 0.05, 0.272]}>
                  <planeGeometry args={[0.22, 0.14]} />
                  <meshStandardMaterial color="#f8fafc" roughness={0.3} />
                </mesh>
              )}
              {showQr && <BoxQrLabels bx={bx} bz={bz} />}
            </group>
          ))}

          {/* Layer 2: 4 Boxes */}
          {boxCount > 4 &&
            [
              [-0.28, 0.88, -0.28],
              [0.28, 0.88, -0.28],
              [-0.28, 0.88, 0.28],
              [0.28, 0.88, 0.28],
            ].map(([bx, by, bz], i) => (
              <group key={`b2-${i}`} position={[bx, by, bz]}>
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[0.54, 0.58, 0.54]} />
                  <meshStandardMaterial color="#d97706" roughness={0.8} />
                </mesh>
                {!showQr && (
                  <mesh position={[0, 0.05, 0.272]}>
                    <planeGeometry args={[0.22, 0.14]} />
                    <meshStandardMaterial color="#f8fafc" roughness={0.3} />
                  </mesh>
                )}
                {showQr && <BoxQrLabels bx={bx} bz={bz} />}
              </group>
            ))}

          {/* Optional Stretch-Wrap Film Layer (Dispatch Scene) */}
          {isWrapped && (
            <mesh position={[0, 0.6, 0]}>
              <boxGeometry args={[1.15, 1.25, 1.15]} />
              <meshStandardMaterial
                color="#e0f2fe"
                roughness={0.1}
                metalness={0.3}
                transparent
                opacity={0.38}
              />
            </mesh>
          )}
        </group>
      )}
      </StaticBatch>
    </group>
  );
}
