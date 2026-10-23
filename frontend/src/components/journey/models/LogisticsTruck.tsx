import { RoundedBox } from "@react-three/drei";
import { StaticMeshBatch } from "../StaticMeshBatch";

interface LogisticsTruckProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  doorsOpenProgress?: number;
  wheelRotation?: number;
  steerAngle?: number;
  isReversing?: boolean;
}

type Vector = [number, number, number];

function Panel({
  position,
  size,
  color = "#dce3e8",
  metalness = 0.5,
  roughness = 0.32,
  radius = 0,
  rotation = [0, 0, 0],
}: {
  position: Vector;
  size: Vector;
  color?: string;
  metalness?: number;
  roughness?: number;
  radius?: number;
  rotation?: Vector;
}) {
  const material = (
    <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} />
  );
  return radius ? (
    <RoundedBox
      args={size}
      radius={radius}
      smoothness={3}
      position={position}
      rotation={rotation}
      castShadow
      receiveShadow
    >
      {material}
    </RoundedBox>
  ) : (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      {material}
    </mesh>
  );
}

function Lamp({
  position,
  size,
  color,
  intensity = 0.8,
}: {
  position: Vector;
  size: Vector;
  color: string;
  intensity?: number;
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={intensity}
        roughness={0.15}
      />
    </mesh>
  );
}

function Wheel({
  position,
  spin,
  steer = 0,
  side,
}: {
  position: Vector;
  spin: number;
  steer?: number;
  side: number;
}) {
  return (
    <group position={position} rotation={[0, steer, 0]}>
      <group rotation={[spin, 0, 0]}>
        {/* Rubber Tire Tread */}
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.49, 0.49, 0.34, 32]} />
          <meshStandardMaterial color="#1a1e23" roughness={0.92} />
        </mesh>
        {/* Tire Grooves */}
        {[-0.11, 0, 0.11].map((x) => (
          <mesh key={x} position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[0.475, 0.018, 6, 32]} />
            <meshStandardMaterial color="#0b0e12" roughness={1} />
          </mesh>
        ))}
        {/* Alloy Rim Outer */}
        <mesh position={[side * 0.18, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.32, 0.32, 0.035, 32]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.88} roughness={0.22} />
        </mesh>
        {/* Hub Cap */}
        <mesh position={[side * 0.205, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.14, 0.16, 0.09, 24]} />
          <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* Lug Bolts */}
        {Array.from({ length: 8 }, (_, i) => {
          const angle = (i * Math.PI) / 4;
          return (
            <mesh
              key={i}
              position={[side * 0.205, Math.sin(angle) * 0.225, Math.cos(angle) * 0.225]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.035, 0.035, 0.015, 8]} />
              <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.4} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

export function LogisticsTruck({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  doorsOpenProgress = 0,
  wheelRotation = 0,
  steerAngle = 0,
  isReversing = false,
}: LogisticsTruckProps) {
  const doorAngle = Math.max(0, Math.min(1, doorsOpenProgress)) * 2.2;

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <StaticMeshBatch dynamic>
        {/* ─── HEAVY STEEL LADDER CHASSIS ─── */}
        {[-0.72, 0.72].map((x) => (
          <Panel
            key={x}
            position={[x, 0.58, 0]}
            size={[0.16, 0.24, 9.6]}
            color="#1e293b"
            metalness={0.7}
          />
        ))}
        {/* Crossmembers */}
        {[-4.2, -2.6, 0, 2.2, 3.8].map((z) => (
          <Panel
            key={z}
            position={[0, 0.58, z]}
            size={[1.4, 0.18, 0.12]}
            color="#0f172a"
            metalness={0.8}
          />
        ))}

        {/* ─── RUNNING GEAR & WHEELS ─── */}
        {/* Front Steer Axle */}
        <group position={[0, 0.49, 3.65]}>
          <Panel position={[0, 0, 0]} size={[2.25, 0.15, 0.16]} color="#0f172a" />
          {[-1, 1].map((side) => (
            <Wheel
              key={side}
              position={[side * 1.12, 0, 0]}
              side={side}
              spin={wheelRotation}
              steer={steerAngle}
            />
          ))}
        </group>

        {/* Rear Tandem Axles */}
        {[-2.6, -3.85].map((z) => (
          <group key={z} position={[0, 0.49, z]}>
            <Panel position={[0, 0, 0]} size={[2.25, 0.15, 0.16]} color="#0f172a" />
            {[-1, 1].map((side) => (
              <Wheel key={side} position={[side * 1.12, 0, 0]} side={side} spin={wheelRotation} />
            ))}
          </group>
        ))}

        {/* Mud Flaps & Rear Flap Badges */}
        {[-1, 1].map((side) => (
          <group key={side}>
            <Panel
              position={[side * 1.12, 0.38, -4.43]}
              size={[0.42, 0.48, 0.05]}
              color="#090d12"
              roughness={0.9}
            />
            <Panel
              position={[side * 1.12, 0.22, -4.41]}
              size={[0.3, 0.1, 0.01]}
              color="#f1f5f9"
              roughness={0.2}
            />
          </group>
        ))}

        {/* ─── CAB-OVER TRACTOR UNIT (WHITE/SLATE ENTERPRISE LOGISTICS) ─── */}
        {/* Main Lower Cab Structure */}
        <Panel
          position={[0, 1.39, 3.85]}
          size={[2.22, 1.12, 2.15]}
          color="#f8fafc"
          metalness={0.2}
          roughness={0.3}
          radius={0.12}
        />
        {/* Upper Sleeper / Wind Deflector Cab */}
        <Panel
          position={[0, 2.2, 3.65]}
          size={[2.18, 0.85, 1.72]}
          color="#f1f5f9"
          metalness={0.2}
          roughness={0.3}
          radius={0.14}
        />
        {/* Aerodynamic Roof Fairing */}
        <Panel
          position={[0, 2.68, 3.4]}
          size={[2.14, 0.28, 1.46]}
          color="#e2e8f0"
          radius={0.12}
          rotation={[-0.12, 0, 0]}
        />

        {/* Windshield Rubber Surround & Glass */}
        <Panel
          position={[0, 2.23, 4.48]}
          size={[1.98, 0.72, 0.065]}
          color="#0f172a"
          radius={0.045}
          rotation={[-0.12, 0, 0]}
        />
        {/* Windshield Glass (Deep Blue Tint with Reflective Surface) */}
        <Panel
          position={[0, 2.25, 4.525]}
          size={[1.82, 0.58, 0.025]}
          color="#1e3a8a"
          metalness={0.9}
          roughness={0.15}
          radius={0.025}
          rotation={[-0.12, 0, 0]}
        />
        {/* Center Windshield Divider & Wiper Arms */}
        <Panel position={[0, 2.23, 4.55]} size={[0.035, 0.62, 0.025]} color="#0f172a" />
        {[-0.45, 0.45].map((wx) => (
          <Panel
            key={wx}
            position={[wx, 1.98, 4.56]}
            size={[0.42, 0.02, 0.02]}
            color="#020617"
            rotation={[0, 0, 0.25]}
          />
        ))}

        {/* Interior Dashboard Accent Silhouette */}
        <Panel position={[0, 1.95, 4.25]} size={[1.75, 0.15, 0.35]} color="#1e293b" />
        <Panel
          position={[-0.45, 2.05, 4.12]}
          size={[0.28, 0.28, 0.04]}
          color="#020617"
          rotation={[0.3, 0, 0]}
        />

        {/* Cab Side Windows & Door Handles */}
        {[-1, 1].map((side) => (
          <group key={side}>
            {/* Side Window Frame */}
            <Panel
              position={[side * 1.085, 2.21, 3.66]}
              size={[0.035, 0.57, 1.27]}
              color="#0f172a"
              radius={0.014}
            />
            {/* Door Panel Accent */}
            <Panel
              position={[side * 1.11, 1.62, 3.64]}
              size={[0.025, 0.46, 1.17]}
              color="#e2e8f0"
            />
            {/* Recessed Door Handle */}
            <Panel
              position={[side * 1.13, 1.78, 3.18]}
              size={[0.04, 0.065, 0.22]}
              color="#334155"
              radius={0.018}
            />

            {/* Aerodynamic Dual-Arm Mirror Bracket */}
            <Panel
              position={[side * 1.27, 2.07, 4.22]}
              size={[0.37, 0.045, 0.055]}
              color="#0f172a"
            />
            <Panel
              position={[side * 1.43, 2.2, 4.2]}
              size={[0.16, 0.45, 0.22]}
              color="#1e293b"
              radius={0.055}
            />
            {/* Reflective Chrome Mirror Face */}
            <Panel
              position={[side * 1.435, 2.2, 4.075]}
              size={[0.115, 0.36, 0.015]}
              color="#f8fafc"
              metalness={0.95}
              roughness={0.1}
            />

            {/* Access Step Ladder */}
            {[0.79, 0.99].map((y) => (
              <Panel
                key={y}
                position={[side * 1.06, y, 2.94]}
                size={[0.32, 0.08, 0.45]}
                color="#475569"
                metalness={0.7}
              />
            ))}

            {/* Front Wheel Arc Guard */}
            <mesh
              position={[side * 1.12, 0.49, 3.65]}
              rotation={[0, (side * Math.PI) / 2, 0]}
              castShadow
            >
              <torusGeometry args={[0.57, 0.095, 8, 24, Math.PI]} />
              <meshStandardMaterial color="#1e293b" roughness={0.65} />
            </mesh>

            {/* Headlight Pods */}
            <Panel
              position={[side * 0.81, 1.16, 4.94]}
              size={[0.48, 0.26, 0.055]}
              color="#0f172a"
              radius={0.045}
            />
            {/* Dual LED Projector Headlights */}
            <Lamp
              position={[side * 0.77, 1.19, 4.977]}
              size={[0.28, 0.115, 0.02]}
              color="#f8fafc"
              intensity={2.2}
            />
            {/* Front Orange Turn Indicator */}
            <Lamp
              position={[side * 0.99, 1.19, 4.978]}
              size={[0.075, 0.115, 0.02]}
              color="#f97316"
              intensity={1.2}
            />

            {/* Side Fuel Tank & Battery Box */}
            <Panel
              position={[side * 0.99, 0.67, 0.99]}
              size={[0.38, 0.48, 1.35]}
              color="#94a3b8"
              metalness={0.8}
              roughness={0.25}
              radius={0.09}
            />
            {/* Fuel Tank Straps */}
            {[-0.4, 0.4].map((sz) => (
              <Panel
                key={sz}
                position={[side * 1.0, 0.67, 0.99 + sz]}
                size={[0.39, 0.5, 0.05]}
                color="#0f172a"
                metalness={0.9}
              />
            ))}

            {/* Side Guard Rails */}
            {[-2.6, -3.85].map((z) => (
              <Panel
                key={z}
                position={[side * 1.12, 1.06, z]}
                size={[0.44, 0.12, 1.15]}
                color="#334155"
                radius={0.05}
              />
            ))}
          </group>
        ))}

        {/* Front Radiator Grille & Chrome Louvers */}
        <Panel
          position={[0, 1.3, 4.945]}
          size={[1.04, 0.48, 0.04]}
          color="#020617"
          radius={0.035}
        />
        {[1.14, 1.25, 1.36, 1.47].map((y) => (
          <Panel
            key={y}
            position={[0, y, 4.98]}
            size={[0.94, 0.025, 0.025]}
            color="#94a3b8"
            metalness={0.85}
          />
        ))}
        {/* Front Bumper & License Plate */}
        <Panel position={[0, 0.89, 4.87]} size={[2.18, 0.2, 0.24]} color="#475569" radius={0.065} />
        <Panel position={[0, 0.91, 5.005]} size={[0.52, 0.14, 0.02]} color="#fef08a" />

        {/* ─── CARGO CONTAINER TRAILER (SMART LOGISTICS FREIGHT) ─── */}
        <Panel
          position={[0, 0.89, -1.2]}
          size={[2.32, 0.17, 7.2]}
          color="#475569"
          metalness={0.6}
        />
        {/* Container Roof */}
        <Panel position={[0, 3.06, -1.2]} size={[2.34, 0.1, 7.24]} color="#f1f5f9" />
        {/* Front Bulkhead */}
        <Panel position={[0, 1.98, 2.36]} size={[2.3, 2.1, 0.08]} color="#e2e8f0" />

        {/* Corrugated Side Walls */}
        {[-1, 1].map((side) => (
          <group key={side}>
            <Panel position={[side * 1.12, 1.98, -1.2]} size={[0.07, 2.1, 7.2]} color="#cbd5e1" />
            {Array.from({ length: 24 }, (_, i) => (
              <Panel
                key={i}
                position={[side * 1.17, 2.06, -4.6 + i * 0.29]}
                size={[0.045, 1.85, 0.055]}
                color="#f8fafc"
              />
            ))}
            {/* Enterprise Logistics Stripe */}
            <Panel position={[side * 1.18, 1.18, -1.2]} size={[0.04, 0.21, 7.15]} color="#0284c7" />
            {[0.97, 3].map((y) => (
              <Panel
                key={y}
                position={[side * 1.18, y, -1.2]}
                size={[0.065, 0.065, 7.2]}
                color="#64748b"
              />
            ))}
            {/* Side Marker Lights */}
            {[-4.4, -2.3, 0, 2.1].map((z) => (
              <Lamp
                key={z}
                position={[side * 1.21, 1.02, z]}
                size={[0.025, 0.075, 0.16]}
                color="#f97316"
                intensity={1.0}
              />
            ))}

            {/* Rear Swing Doors with Locking Bars & Handles */}
            <group position={[side * 1.14, 1.98, -4.83]} rotation={[0, side * doorAngle, 0]}>
              <Panel position={[-side * 0.555, 0, 0]} size={[1.1, 2.05, 0.075]} color="#cbd5e1" />
              {[-0.34, -0.79].map((offset) => (
                <Panel
                  key={offset}
                  position={[side * offset, 0, -0.065]}
                  size={[0.035, 1.92, 0.04]}
                  color="#475569"
                  metalness={0.8}
                />
              ))}
              {[-0.77, 0, 0.77].map((y) => (
                <Panel
                  key={y}
                  position={[-side * 0.08, y, -0.065]}
                  size={[0.17, 0.08, 0.05]}
                  color="#334155"
                  metalness={0.8}
                />
              ))}
              <Panel
                position={[-side * 0.58, -0.34, -0.1]}
                size={[0.3, 0.055, 0.055]}
                color="#1e293b"
              />
            </group>

            {/* Tail Light Assemblies */}
            <Lamp
              position={[side * 0.91, 0.79, -4.85]}
              size={[0.27, 0.14, 0.04]}
              color="#dc2626"
              intensity={1.5}
            />
            <Lamp
              position={[side * 0.64, 0.79, -4.85]}
              size={[0.16, 0.14, 0.04]}
              color={isReversing ? "#f8fafc" : "#334155"}
              intensity={isReversing ? 2.5 : 0}
            />
          </group>
        ))}

        {/* Rear Crash Bumper */}
        <Panel
          position={[0, 0.48, -4.83]}
          size={[2.12, 0.13, 0.18]}
          color="#64748b"
          metalness={0.6}
        />
      </StaticMeshBatch>
    </group>
  );
}
