import * as THREE from "three";
import { computeJourneyKinematics } from "./journeyKinematics";
import { supplierJourney } from "./supplierJourney";

const ease = (value: number, start: number, end: number) => THREE.MathUtils.smootherstep(value, start, end);

export function cameraPose(raw: number) {
  const p = Math.max(0, (raw - 0.12) / 0.88);
  const supplier = supplierJourney(Math.min(1, raw / 0.12));
  const actor = computeJourneyKinematics(p, 1, raw);
  const [tx, , tz] = actor.truck1Pos;
  const [fx, , fz] = actor.forkliftPos;
  const [ex, , ez] = actor.truckExitPos;
  const position = new THREE.Vector3(tx - 13, 13, tz + 18);
  const target = new THREE.Vector3(tx, 2, tz - 2);
  if (raw < 0.12) {
    const weight = 1 - ease(raw, 0.102, 0.12);
    position.lerp(new THREE.Vector3(supplier.truck.x - 11, 12, supplier.truck.z + 17), weight);
    target.lerp(new THREE.Vector3(supplier.truck.x, 2.4, supplier.truck.z), weight);
  }
  const forkliftWeight = ease(p, 0.20, 0.27);
  // Look down the working aisle, not across the intervening loaded racks.
  position.lerp(new THREE.Vector3(fx - 1.5, 21, fz + 10), forkliftWeight);
  target.lerp(new THREE.Vector3(fx, 1.8, fz), forkliftWeight);
  const assemblyWeight = ease(p, 0.59, 0.69);
  // View the cell from inside the warehouse; the dock facade is behind it.
  position.lerp(new THREE.Vector3(5, 8.5, -39), assemblyWeight);
  target.lerp(new THREE.Vector3(12, 2, -29), assemblyWeight);
  const dispatchWeight = ease(p, 0.84, 0.93);
  position.lerp(new THREE.Vector3(ex - 15, 16, ez + 20), dispatchWeight);
  target.lerp(new THREE.Vector3(ex, 2, ez - 3), dispatchWeight);
  // Actor pauses are intentional (inspection, putaway, assembly), but the
  // camera must still respond to scrolling through them in either direction.
  position.x += Math.sin(raw * Math.PI * 2) * 1.2;
  position.z += raw * 2;
  return { position, target };
}

// Cache route samples once; rendering only evaluates two splines, with no
// kinematics duplication or Vector3 allocations in the animation loop.
const samples = Array.from({ length: 401 }, (_, i) => cameraPose(i / 400));
export const cameraPositionPath = new THREE.CatmullRomCurve3(samples.map(s => s.position), false, "centripetal");
export const cameraTargetPath = new THREE.CatmullRomCurve3(samples.map(s => s.target), false, "centripetal");
