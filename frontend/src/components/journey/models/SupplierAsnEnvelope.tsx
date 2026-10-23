import { SceneHtml as Html } from "../SceneHtml";
import { supplierJourney } from "../supplierJourney";
import type { ThreeElements } from "@react-three/fiber";

type SupplierAsnEnvelopeProps = ThreeElements["group"] & {
  progress: number;
  asn?: any;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value: number) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

/** A procedural envelope used only for the read-only landing-page story. */
export function SupplierAsnEnvelope({ progress, asn, ...groupProps }: SupplierAsnEnvelopeProps) {
  for (const key of Object.keys(groupProps)) {
    if (key.startsWith("data-") || key.startsWith("aria-"))
      delete (groupProps as Record<string, unknown>)[key];
  }
  const delivery = supplierJourney(progress);
  const travel = smoothstep((progress - 0.12) / 0.53);
  const arrival = smoothstep((progress - 0.45) / 0.2);
  const open = delivery.open;
  // Follow the existing inbound camera corridor. The camera moves from the
  // front approach (z ~= 43) to the receiving checkpoint (z ~= -17) during
  // this same local ASN interval, so keeping the envelope on that corridor
  // prevents it from disappearing behind or beyond the active camera.
  const x = delivery.envelope.x;
  const z = delivery.envelope.z;
  const y = delivery.envelope.y;
  const flapAngle = -open * Math.PI * 0.82;
  const documentY = 0.12 + open * 1.05;
  const documentScale = 0.72 + open * 0.28;
  const text = (value: unknown) =>
    value === null || value === undefined || value === "" ? "—" : String(value);

  return (
    <group
      {...groupProps}
      position={[x, y, z]}
      rotation={[0.05, travel * 0.55, Math.sin(travel * Math.PI) * 0.08]}
      frustumCulled={false}
      renderOrder={100}
    >
      <group scale={0.45 * (1 - smoothstep((progress - 0.97) / 0.03))}>
        {/* Envelope body and folded front */}
        <mesh castShadow receiveShadow renderOrder={100}>
          <boxGeometry args={[3.2, 0.12, 2.15]} />
          <meshStandardMaterial
            color="#f8fafc"
            emissive="#164e63"
            emissiveIntensity={0.16}
            roughness={0.48}
            metalness={0.06}
            depthTest={false}
          />
        </mesh>
        <mesh position={[0, 0.08, 0.01]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={101}>
          <planeGeometry args={[2.05, 3.08]} />
          <meshStandardMaterial color="#dbeafe" roughness={0.6} side={2} depthTest={false} />
        </mesh>
        {/* Flap stays closed during travel and opens only at security. */}
        <group position={[0, 0.1, -1.04]} rotation={[flapAngle, 0, 0]}>
          <mesh position={[0, 0.02, 0.52]} rotation={[Math.PI / 2, 0, 0]} renderOrder={102}>
            <planeGeometry args={[3.05, 1.05]} />
            <meshStandardMaterial color="#bfdbfe" roughness={0.55} side={2} depthTest={false} />
          </mesh>
        </group>
        <mesh position={[0, 0.16, 0]} renderOrder={103}>
          <boxGeometry args={[0.28, 0.035, 0.28]} />
          <meshStandardMaterial
            color="#06b6d4"
            emissive="#22d3ee"
            emissiveIntensity={0.8}
            depthTest={false}
          />
        </mesh>
        {/* ASN document emerges only after the envelope reaches security. */}
        <group position={[0, documentY, 0.12]} scale={documentScale}>
          <mesh visible={open > 0.01} castShadow renderOrder={104}>
            <boxGeometry args={[2.35, 0.035, 1.55]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#cffafe"
              emissiveIntensity={0.25}
              roughness={0.7}
              depthTest={false}
            />
          </mesh>
          {open > 0.08 && (
            <Html
              position={[0, 0.04, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              transform
              distanceFactor={8}
              zIndexRange={[20, 0]}
            >
              <div className="w-52 rounded-md border border-cyan-400/50 bg-slate-950/95 p-2 text-left font-mono text-[8px] text-white shadow-xl">
                <div className="mb-1 border-b border-cyan-400/30 pb-1 text-[9px] font-black tracking-widest text-cyan-300">
                  ASN DOCUMENT
                </div>
                <div>ASN: {text(asn?.asn_number)}</div>
                <div>SUPPLIER: {text(asn?.supplier_name)}</div>
                <div>PO: {text(asn?.po_number)}</div>
                <div>EXPECTED: {text(asn?.expected_arrival_at || asn?.expected_arrival_date)}</div>
                <div>VEHICLE: {text(asn?.vehicle_number)}</div>
                <div>STATUS: {text(asn?.status)}</div>
              </div>
            </Html>
          )}
        </group>
        <Html position={[0, 1.5, 0]} center distanceFactor={10} zIndexRange={[20, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded-full border border-cyan-400/40 bg-slate-950/85 px-2 py-1 font-mono text-[9px] font-bold tracking-widest text-cyan-300">
            {open > 0.04
              ? "ASN RECEIVED BY SECURITY"
              : arrival > 0.2
                ? "SECURITY CHECKPOINT"
                : "ASN SENT"}
          </div>
        </Html>
      </group>
    </group>
  );
}
