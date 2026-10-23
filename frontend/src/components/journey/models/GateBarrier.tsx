import { SecurityRoom } from "./SecurityRoom";

interface GateBarrierProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  barrierOpenProgress?: number; // 0 (closed) to 1 (fully open)
  securitySide?: "left" | "right";
  gateType?: "entry" | "exit";
}

export function GateBarrier({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  barrierOpenProgress = 0,
  securitySide = "right",
  gateType = "entry",
}: GateBarrierProps) {
  const opening = Math.max(0, Math.min(1, barrierOpenProgress));
  const isCleared = opening > 0.15;

  return (
    <group position={position} rotation={rotation}>
      <group>
        <SecurityRoom clearance={opening} side={securitySide} gateType={gateType} />
      </group>

      {/* ─── VEHICLE DETECTION ZONE & SPEED BUMP ─── */}
      <group position={[0, 0.05, 0]}>
        {/* Detection Loop Asphalt Pad */}
        <mesh position={[0, 0.002, 1.8]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[4.8, 3.2]} />
          <meshStandardMaterial color="#1e293b" roughness={0.8} />
        </mesh>
        {/* Detection Loop Outline */}
        <mesh position={[0, 0.006, 1.8]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[4.4, 2.8]} />
          <meshStandardMaterial
            color={isCleared ? "#10b981" : "#06b6d4"}
            wireframe
            transparent
            opacity={0.6}
          />
        </mesh>

        {/* Black & Yellow Striped Speed Bump */}
        <mesh position={[0, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[5.2, 0.1, 0.7]} />
          <meshStandardMaterial color="#0f172a" roughness={0.7} />
        </mesh>
        {[-2.0, -1.0, 0.0, 1.0, 2.0].map((bx, i) => (
          <mesh key={i} position={[bx, 0.06, 0]}>
            <boxGeometry args={[0.45, 0.04, 0.72]} />
            <meshStandardMaterial color="#eab308" roughness={0.4} />
          </mesh>
        ))}
      </group>

      {/* ─── AUTOMATED LICENSE PLATE RECOGNITION (ALPR) CAMERA POLE ─── */}
      <group position={[securitySide === "left" ? -2.8 : 2.8, 0, 3.2]}>
        <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.04, 0.05, 2.8, 12]} />
          <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* Camera Housing */}
        <mesh
          position={[securitySide === "left" ? 0.25 : -0.25, 2.6, 0]}
          rotation={[0.15, securitySide === "left" ? -0.3 : 0.3, 0]}
        >
          <boxGeometry args={[0.18, 0.14, 0.35]} />
          <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.2} />
        </mesh>
        {/* Lens Glass & Infra-Red Illuminator */}
        <mesh position={[securitySide === "left" ? 0.25 : -0.25, 2.6, -0.18]}>
          <cylinderGeometry args={[0.05, 0.05, 0.02, 16]} />
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#06b6d4"
            emissiveIntensity={1.5}
            roughness={0.1}
          />
        </mesh>
      </group>

      {/* ─── INFRARED SAFETY BEAM SENSORS ─── */}
      {[-2.4, 2.4].map((x, i) => (
        <group key={i} position={[x, 0.45, 0.2]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.035, 0.045, 0.9, 12]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} />
          </mesh>
          <mesh position={[0, 0.38, 0]}>
            <sphereGeometry args={[0.04, 12, 12]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={2} />
          </mesh>
        </group>
      ))}

      {/* ─── BARRIER STANCHION HOUSING (VIBRANT INDUSTRIAL YELLOW) ─── */}
      <group position={[2.4, 0.75, 0]}>
        <mesh position={[0, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.5, 1.5, 0.6]} />
          <meshStandardMaterial color="#f59e0b" metalness={0.7} roughness={0.3} />
        </mesh>

        {/* LED Status Ring */}
        <mesh position={[0, 0.82, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.15, 16]} />
          <meshStandardMaterial
            color={opening > 0.8 ? "#22c55e" : opening > 0.05 ? "#06b6d4" : "#ef4444"}
            emissive={opening > 0.8 ? "#22c55e" : opening > 0.05 ? "#06b6d4" : "#ef4444"}
            emissiveIntensity={2.5}
          />
        </mesh>

        {/* ─── ROTATING BOOM BARRIER ARM ─── */}
        <group position={[-0.26, 0.5, 0]} rotation={[0, 0, -opening * 1.5]}>
          {/* Main Arm (Red/White Safety Striped) */}
          <mesh position={[-2.4, 0, 0]} castShadow>
            <boxGeometry args={[4.8, 0.12, 0.08]} />
            <meshStandardMaterial color="#f8fafc" metalness={0.3} roughness={0.5} />
          </mesh>
          {/* Red Safety Stripes */}
          {[-1.0, -2.0, -3.0, -4.0].map((stripeX, i) => (
            <mesh key={i} position={[stripeX, 0, 0]}>
              <boxGeometry args={[0.4, 0.125, 0.085]} />
              <meshStandardMaterial color="#dc2626" />
            </mesh>
          ))}
          {/* Top LED Light Strip */}
          <mesh position={[-2.4, 0.065, 0]}>
            <boxGeometry args={[4.7, 0.015, 0.03]} />
            <meshStandardMaterial
              color={opening > 0.8 ? "#22c55e" : "#ef4444"}
              emissive={opening > 0.8 ? "#22c55e" : "#ef4444"}
              emissiveIntensity={2}
            />
          </mesh>
          {/* Glowing Tip LED Beacon */}
          <mesh position={[-4.8, 0, 0]}>
            <sphereGeometry args={[0.08, 12, 12]} />
            <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={3} />
          </mesh>
        </group>
      </group>

      {/* Left Curb / Receiver Stanchion */}
      <mesh position={[-2.4, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.4, 0.8, 0.4]} />
        <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}
