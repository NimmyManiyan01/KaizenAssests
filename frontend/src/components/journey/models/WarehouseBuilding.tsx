import { WarehouseCompound } from "./WarehouseCompound";
import { WarehouseAsset } from "./WarehouseAsset";

export function WarehouseBuilding() {
  return (
    <group>
      <WarehouseAsset />
      <WarehouseCompound />
      <mesh position={[18.5, 0.004, 22]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[5.8, 58]} />
        <meshStandardMaterial color="#30383f" roughness={0.96} />
      </mesh>
      {[-2.65, 2.65].map(x => (
        <mesh key={`exit-${x}`} position={[18.5 + x, 0.015, 22]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.12, 58]} />
          <meshStandardMaterial color="#f1eee0" />
        </mesh>
      ))}
      {/* Open roof keeps the overhead journey visible, as in the reference. */}
      {/* ─── GROUND / FLOORS ─── */}
      {/* Concrete yard and a dedicated inbound asphalt road through the security gate. */}
      <mesh position={[0, -0.02, 25]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[70, 50]} />
        <meshStandardMaterial color="#788582" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.002, 25]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[5.8, 50]} />
        <meshStandardMaterial color="#30383f" roughness={0.96} metalness={0} />
      </mesh>
      {/* The road opens into the truck turning apron inside the entrance. */}
      <mesh position={[-4, 0.002, -10]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[28, 20]} />
        <meshStandardMaterial color="#414c55" roughness={0.9} />
      </mesh>
      {[-2.65, 2.65].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.012, 25]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.12, 50]} />
            <meshStandardMaterial color="#f1eee0" roughness={0.9} />
          </mesh>
          {/* Leave the checkpoint shoulder open for the guard and security room. */}
          {[5, 23, 29, 35, 41, 47].map((z, i) => (
            <mesh key={z} position={[Math.sign(x) * 3.03, 0.09, z]} receiveShadow castShadow>
              <boxGeometry args={[0.26, 0.18, z === 5 ? 10 : 5.9]} />
              <meshStandardMaterial color={i % 2 ? "#d9d5c9" : "#55616b"} roughness={0.85} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Painted direction arrows follow the truck toward the warehouse. */}
      {[8, 27, 40].map((z) => (
        <group key={z} position={[0, 0.014, z]}>
          <mesh position={[0, 0, 0.4]}>
            <boxGeometry args={[0.17, 0.008, 1.35]} />
            <meshStandardMaterial color="#f4f0dc" roughness={0.9} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * 0.24, 0, -0.18]}
              rotation={[0, (side * Math.PI) / 4, 0]}
            >
              <boxGeometry args={[0.16, 0.008, 0.72]} />
              <meshStandardMaterial color="#f4f0dc" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 0.018, 16.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5.2, 0.35]} />
        <meshStandardMaterial color="#ffffff" roughness={0.8} />
      </mesh>

      {/* Interior Concrete Polished Floor (Z from 0 to -300) */}
      <mesh position={[0, 0, -145]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 290]} />
        <meshStandardMaterial color="#94a3ab" roughness={0.7} metalness={0.1} />
      </mesh>

      {/* Floor Floor Guidance Lines / Safety Striping */}
      {[-8, 0, 8].map((lx, i) => (
        <mesh key={i} position={[lx, 0.01, -145]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.15, 280]} />
          <meshStandardMaterial
            color="#06b6d4"
            emissive="#0891b2"
            emissiveIntensity={0.4}
            transparent
            opacity={0.35}
          />
        </mesh>
      ))}

      {/* The imported cutaway owns the facade and structural frame. */}
    </group>
  );
}
