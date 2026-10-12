import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { LogisticsTruck } from "./LogisticsTruck";

function TrafficCar({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.65, 0]} castShadow>
        <boxGeometry args={[1.8, 0.65, 4]} />
        <meshStandardMaterial color={color} metalness={0.45} roughness={0.3} />
      </mesh>
      <mesh position={[0, 1.15, -0.2]} castShadow>
        <boxGeometry args={[1.5, 0.65, 2.1]} />
        <meshStandardMaterial color="#344955" metalness={0.5} roughness={0.2} />
      </mesh>
      {[-1, 1].flatMap((side) =>
        [-1.25, 1.25].map((z) => (
          <mesh
            key={`${side}-${z}`}
            position={[side * 0.88, 0.38, z]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.38, 0.38, 0.22, 12]} />
            <meshStandardMaterial color="#20252a" roughness={0.9} />
          </mesh>
        )),
      )}
      {[-0.58, 0.58].map((x) => (
        <mesh key={x} position={[x, 0.73, 2.02]}>
          <boxGeometry args={[0.4, 0.18, 0.06]} />
          <meshStandardMaterial color="#fff5d9" emissive="#fff5d9" emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function makeRoute() {
  const route = new THREE.CurvePath<THREE.Vector3>();
  // Rounded loop on the city ring-road lane, clear of the warehouse compound.
  const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);
  const line = (a: THREE.Vector3, b: THREE.Vector3) => route.add(new THREE.LineCurve3(a, b));
  const turn = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    route.add(new THREE.QuadraticBezierCurve3(a, b, c));
  line(v(-108, 50), v(108, 50));
  turn(v(108, 50), v(110, 50), v(110, 48));
  line(v(110, 48), v(110, -376));
  turn(v(110, -376), v(110, -378), v(108, -378));
  line(v(108, -378), v(-108, -378));
  turn(v(-108, -378), v(-110, -378), v(-110, -376));
  line(v(-110, -376), v(-110, 48));
  turn(v(-110, 48), v(-110, 50), v(-108, 50));
  return route;
}

export function CityTraffic() {
  const vehicles = useRef<Array<THREE.Group | null>>([]);
  const distance = useRef(0);
  const route = useMemo(makeRoute, []);
  const length = useMemo(() => route.getLength(), [route]);
  useFrame((_, delta) => {
    distance.current = (distance.current + Math.min(delta, 0.05) * 8) % length;
    vehicles.current.forEach((vehicle, index) => {
      if (!vehicle) return;
      const progress = (distance.current / length + index / 12) % 1;
      vehicle.position.copy(route.getPoint(progress));
      const tangent = route.getTangent(progress);
      vehicle.rotation.y = Math.atan2(tangent.x, tangent.z);
    });
  });
  return (
    <group>
      {Array.from({ length: 12 }, (_, index) => (
        <group
          key={index}
          ref={(node) => {
            vehicles.current[index] = node;
          }}
        >
          {index % 4 === 0 ? (
            <LogisticsTruck scale={0.65} />
          ) : (
            <TrafficCar
              color={["#d1d5db", "#3c6675", "#ac4b3e", "#d6c8a5"][index % 4] ?? "#d1d5db"}
            />
          )}
        </group>
      ))}
    </group>
  );
}
