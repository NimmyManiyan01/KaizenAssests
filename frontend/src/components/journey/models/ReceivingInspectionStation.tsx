import { Text } from "@react-three/drei";

type Vector = [number, number, number];
type DemoOutcome = "ACCEPTED" | "REJECTED" | "DAMAGED" | "HELD";

function readDemoOutcome(): DemoOutcome {
  if (typeof window === "undefined") return "ACCEPTED";
  const value = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("qc");
  return value === "REJECTED" || value === "DAMAGED" || value === "HELD" ? value : "ACCEPTED";
}

function Panel({
  position,
  size,
  color,
  emissive,
  intensity = 0,
}: {
  position: Vector;
  size: Vector;
  color: string;
  emissive?: string;
  intensity?: number;
}) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        emissive={emissive ?? color}
        emissiveIntensity={intensity}
        roughness={0.5}
        metalness={0.35}
      />
    </mesh>
  );
}

export function ReceivingInspectionStation({ progress = 0 }: { progress?: number }) {
  const normalized = Math.max(0, Math.min(1, progress));
  const receiving = normalized >= 0.22;
  const qcActive = normalized >= 0.235;
  const demoOutcome = readDemoOutcome();
  const qcComplete = normalized >= 0.255;
  const accepted = qcComplete && demoOutcome === "ACCEPTED";
  const activeStatus: DemoOutcome | "INSPECTING" | "RECEIVED" | "VERIFYING" = qcComplete
    ? demoOutcome
    : qcActive
      ? "INSPECTING"
      : receiving
        ? "RECEIVED"
        : "VERIFYING";
  const activeColor = qcComplete
    ? demoOutcome === "REJECTED"
      ? "#ef4444"
      : demoOutcome === "DAMAGED"
        ? "#f97316"
        : demoOutcome === "HELD"
          ? "#eab308"
          : "#22c55e"
    : qcActive
      ? "#f59e0b"
      : receiving
        ? "#38bdf8"
        : "#64748b";

  return (
    <group position={[-5.2, 0, -22.1]}>
      {/* Compact steel receiving desk and inspection platform. */}
      <Panel position={[0, 0.7, 0]} size={[2.6, 1.4, 1.1]} color="#334155" />
      <Panel position={[0, 1.45, 0]} size={[2.8, 0.12, 1.2]} color="#94a3b8" />
      <Panel position={[0, 1.75, -0.38]} size={[1.45, 0.52, 0.06]} color="#0f172a" />
      <Panel
        position={[0, 1.75, -0.345]}
        size={[1.22, 0.32, 0.025]}
        color="#0b2230"
        emissive={activeColor}
        intensity={1.5}
      />
      <Text
        position={[0, 1.78, -0.37]}
        rotation={[0, 0, 0]}
        fontSize={0.12}
        color="#dffaff"
        anchorX="center"
        anchorY="middle"
      >
        {`GRN ${activeStatus}`}
      </Text>

      {/* Digital scale with a restrained cyan weighing surface. */}
      <Panel position={[-1.9, 0.28, 0.1]} size={[1.8, 0.18, 1.45]} color="#475569" />
      <Panel
        position={[-1.9, 0.4, 0.1]}
        size={[1.5, 0.05, 1.15]}
        color="#0e7490"
        emissive="#06b6d4"
        intensity={0.45}
      />
      <Text
        position={[-1.9, 0.54, 0.1]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.16}
        color="#cffafe"
        anchorX="center"
        anchorY="middle"
      >
        {receiving ? (accepted ? "480 UNITS" : "0 PUTAWAY") : "SCALE READY"}
      </Text>

      {/* Four explicit QC outcomes. Hash demo mode makes each outcome inspectable without backend state. */}
      {(
        [
          ["ACCEPTED", "#22c55e"],
          ["REJECTED", "#ef4444"],
          ["DAMAGED", "#f97316"],
          ["HELD", "#eab308"],
        ] as const
      ).map(([label, color], index) => (
        <group key={label} position={[1.65, 0.55 + index * 0.34, 0.25]}>
          <Panel
            position={[0, 0, 0]}
            size={[0.18, 0.18, 0.08]}
            color={activeStatus === label ? color : "#334155"}
            emissive={color}
            intensity={activeStatus === label ? 2 : 0.1}
          />
          <Text
            position={[0.2, 0, -0.05]}
            fontSize={0.1}
            color={activeStatus === label ? color : "#94a3b8"}
            anchorY="middle"
          >
            {label}
          </Text>
        </group>
      ))}

      {/* Only accepted demo material receives the illustrative batch QR. */}
      {accepted && (
        <group position={[0.65, 2.15, -0.34]}>
          <Panel position={[0, 0, 0]} size={[0.58, 0.58, 0.025]} color="#f8fafc" />
          {[0, 1, 2, 3].map((row) =>
            [0, 1, 2, 3].map((column) => (
              <Panel
                key={`${row}-${column}`}
                position={[-0.18 + column * 0.12, 0.18 - row * 0.12, -0.02]}
                size={[0.06, 0.06, 0.012]}
                color={(row * 3 + column) % 2 ? "#0f172a" : "#f8fafc"}
              />
            )),
          )}
          <Text position={[0, -0.43, 0]} fontSize={0.08} color="#22d3ee" anchorX="center">
            DEMO BATCH QR - MAT-1001
          </Text>
        </group>
      )}
    </group>
  );
}
