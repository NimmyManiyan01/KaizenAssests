import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

interface LoadingDockProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  doorOpenProgress?: number; // 0 to 1
  doorNumber?: string;
  pickupLane?: boolean;
  dockStatus?: DockStatus;
}

export type DockStatus =
  "APPROACHING" | "DOCKED_NOT_AUTHORIZED" | "READY_TO_UNLOAD" | "UNLOADING" | "COMPLETED";

export function LoadingDock({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  doorOpenProgress = 0,
  doorNumber = "BAY D-04",
  pickupLane = false,
  dockStatus = "APPROACHING",
}: LoadingDockProps) {
  const shutterRef = useRef<THREE.Mesh>(null);
  const isGreen = dockStatus === "READY_TO_UNLOAD" || dockStatus === "UNLOADING";
  const isAmber = dockStatus === "APPROACHING";
  const isCompleted = dockStatus === "COMPLETED";
  const statusColor = isGreen
    ? "#22c55e"
    : isAmber
      ? "#f59e0b"
      : isCompleted
        ? "#38bdf8"
        : "#ef4444";

  useFrame(() => {
    if (shutterRef.current) {
      // Shutter rolls up vertically (0 = Y: 1.8, 1 = Y: 4.2)
      shutterRef.current.position.y = 1.8 + doorOpenProgress * 2.4;
      shutterRef.current.scale.y = Math.max(0.1, 1 - doorOpenProgress * 0.85);
    }
  });

  return (
    <group position={position} rotation={rotation}>
      {/* ─── DOCK CONCRETE PLATFORM & RECESSED TRUCK LANE ─── */}
      {pickupLane ? (
        <>
          {[-2.65, 2.65].map((x) => (
            <mesh key={x} position={[x, 0.6, 0]} castShadow receiveShadow>
              <boxGeometry args={[3.1, 1.2, 5.2]} />
              <meshStandardMaterial color="#475569" roughness={0.7} />
            </mesh>
          ))}
          <mesh position={[0, 0.6, 1.675]} castShadow receiveShadow>
            <boxGeometry args={[2.2, 1.2, 1.85]} />
            <meshStandardMaterial color="#334155" roughness={0.75} />
          </mesh>
          {/* Wheel Guide Alignment Lines */}
          {[-1.1, 1.1].map((x) => (
            <mesh key={x} position={[x, 1.21, -0.825]}>
              <boxGeometry args={[0.08, 0.025, 3.35]} />
              <meshStandardMaterial color="#eab308" roughness={0.3} />
            </mesh>
          ))}
        </>
      ) : (
        <mesh position={[0, 0.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[8.2, 1.2, 5.2]} />
          <meshStandardMaterial color="#475569" metalness={0.2} roughness={0.7} />
        </mesh>
      )}

      {/* Yellow/Black Hazard Safety Striping on Dock Edge */}
      <mesh position={[0, 1.21, 2.5]}>
        <boxGeometry args={[8.2, 0.04, 0.22]} />
        <meshStandardMaterial color="#eab308" roughness={0.4} />
      </mesh>
      {[-3.0, -1.8, -0.6, 0.6, 1.8, 3.0].map((hx, i) => (
        <mesh key={i} position={[hx, 1.22, 2.5]}>
          <boxGeometry args={[0.4, 0.042, 0.225]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
      ))}

      {/* ─── HEAVY RUBBER IMPACT BUMPER PADS ─── */}
      {[-1.85, 1.85].map((bx, i) => (
        <group key={i} position={[bx, 0.75, 2.62]}>
          {/* Steel Mounting Plate */}
          <mesh position={[0, 0, -0.06]} castShadow>
            <boxGeometry args={[0.5, 0.85, 0.05]} />
            <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Laminated Rubber Cushion Pad */}
          <mesh castShadow>
            <boxGeometry args={[0.42, 0.8, 0.22]} />
            <meshStandardMaterial color="#090d16" roughness={0.95} />
          </mesh>
        </group>
      ))}

      {/* ─── HYDRAULIC DOCK LEVELER PLATE ─── */}
      <group position={[0, 1.22, pickupLane ? 1.7 : 1.2]} rotation={[0.02, 0, 0]}>
        {/* Main Diamond Plate Deck */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2.4, 0.06, pickupLane ? 1.5 : 2.2]} />
          <meshStandardMaterial color="#0284c7" metalness={0.8} roughness={0.25} />
        </mesh>
        {/* Leveler Hinge Lip */}
        <mesh position={[0, -0.02, 1.1]}>
          <boxGeometry args={[2.36, 0.04, 0.28]} />
          <meshStandardMaterial color="#0369a1" metalness={0.85} roughness={0.2} />
        </mesh>
        {/* Yellow Safety Toe Guards */}
        {[-1.19, 1.19].map((sx, idx) => (
          <mesh key={idx} position={[sx, -0.08, 0]}>
            <boxGeometry args={[0.02, 0.14, 2.1]} />
            <meshStandardMaterial color="#eab308" roughness={0.4} />
          </mesh>
        ))}
      </group>

      {/* ─── INFLATABLE / FOAM DOCK SHELTER SEALS (DOCK ENCLOSURE) ─── */}
      <group position={[0, 2.3, 2.45]}>
        {/* Top Header Shelter Cushion */}
        <mesh position={[0, 1.85, 0]} castShadow>
          <boxGeometry args={[3.8, 0.5, 0.42]} />
          <meshStandardMaterial color="#0f172a" roughness={0.9} />
        </mesh>
        {/* Left Vertical Side Shelter Pad */}
        <mesh position={[-1.75, 0, 0]} castShadow>
          <boxGeometry args={[0.42, 3.2, 0.42]} />
          <meshStandardMaterial color="#0f172a" roughness={0.9} />
        </mesh>
        {/* Right Vertical Side Shelter Pad */}
        <mesh position={[1.75, 0, 0]} castShadow>
          <boxGeometry args={[0.42, 3.2, 0.42]} />
          <meshStandardMaterial color="#0f172a" roughness={0.9} />
        </mesh>

        {/* Yellow Alignment Chevron Strips on Shelter Face */}
        {[-1.75, 1.75].map((sx, idx) => (
          <mesh key={idx} position={[sx, 0, 0.215]}>
            <boxGeometry args={[0.08, 3.0, 0.01]} />
            <meshStandardMaterial color="#eab308" roughness={0.4} />
          </mesh>
        ))}
      </group>

      {/* ─── DOCK TRAFFIC LIGHT SIGNAL ─── */}
      <group position={[2.25, 2.8, 2.55]}>
        {/* Traffic Light Housing */}
        <mesh castShadow>
          <boxGeometry args={[0.18, 0.48, 0.12]} />
          <meshStandardMaterial color="#0f172a" roughness={0.5} />
        </mesh>
        {/* Red stop light remains active until authorization is established. */}
        <mesh position={[0, 0.11, 0.06]}>
          <cylinderGeometry args={[0.05, 0.05, 0.02, 16]} />
          <meshStandardMaterial
            color={statusColor}
            emissive={statusColor}
            emissiveIntensity={isAmber ? 1.2 : isGreen || isCompleted ? 0.3 : 3.0}
          />
        </mesh>
        {/* Green means unloading is authorized, never occupancy alone. */}
        <mesh position={[0, -0.11, 0.06]}>
          <cylinderGeometry args={[0.05, 0.05, 0.02, 16]} />
          <meshStandardMaterial
            color={isGreen ? "#22c55e" : "#334155"}
            emissive={isGreen ? "#22c55e" : "#334155"}
            emissiveIntensity={isGreen ? 3.0 : 0.3}
          />
        </mesh>
      </group>

      {/* ─── SAFETY BOLLARDS ON GROUND LEVEL ─── */}
      {[-2.6, 2.6].map((bx, idx) => (
        <group key={`bollard-${idx}`} position={[bx, 0.5, 3.8]}>
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[0.12, 0.12, 1.0, 16]} />
            <meshStandardMaterial color="#f59e0b" roughness={0.3} metalness={0.6} />
          </mesh>
          {/* Black Hazard Ring */}
          <mesh position={[0, 0.35, 0]}>
            <cylinderGeometry args={[0.125, 0.125, 0.12, 16]} />
            <meshStandardMaterial color="#0f172a" roughness={0.8} />
          </mesh>
        </group>
      ))}

      {/* ─── INDUSTRIAL ROLLUP SHUTTER DOOR ─── */}
      <group position={[0, 0, -2.4]}>
        {/* Door Frame Uprights and Lintel */}
        {[-2.1, 2.1].map((x) => (
          <mesh key={x} position={[x, 2.2, 0]} castShadow>
            <boxGeometry args={[0.22, 4.4, 0.32]} />
            <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.3} />
          </mesh>
        ))}
        <mesh position={[0, 4.3, 0]} castShadow>
          <boxGeometry args={[4.4, 0.22, 0.32]} />
          <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.3} />
        </mesh>

        {/* Vertical Rolling Shutter Slats */}
        <mesh position={[0, 1.8, 0.02]} ref={shutterRef}>
          <boxGeometry args={[3.9, 3.4, 0.05]} />
          <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.4} />
        </mesh>

        {/* Illuminated Bay Number Header Sign */}
        <mesh position={[0, 4.2, 0.2]}>
          <boxGeometry args={[2.2, 0.5, 0.06]} />
          <meshStandardMaterial
            color="#0f172a"
            emissive={
              isGreen ? "#10b981" : isAmber ? "#f59e0b" : isCompleted ? "#0284c7" : "#ef4444"
            }
            emissiveIntensity={1.8}
          />
        </mesh>
      </group>
    </group>
  );
}
