import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import warehouseUrl from "../../../assets/3d-jutsu-KaizenX-Warehouse-Reference-Cutaway-2026-11-13-05-53-59.glb?url";

/** The authored second loading bay (X=-7, Z=20) aligns to the receiving stop. */
export function WarehouseAsset() {
  const { scene } = useGLTF(warehouseUrl);
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.updateMatrixWorld(true);
    const excluded: THREE.Object3D[] = [];
    clone.traverse((object) => {
      // The journey supplies the animated truck, site ground and lighting.
      if (
        /^(Cutaway_roof|Cutaway_west_roof|Pitched_roof_rafter|Roof_truss|Roof_translucent|Standing_seam_roof)/.test(object.name) ||
        /^(Delivery_truck_complete_assembly|Forklift_assembly|Warehouse_worker_assembly|Natural_broadleaf_tree|ENV_|Road_perimeter_yellow)/.test(object.name) ||
        (object as THREE.Camera).isCamera ||
        (object as THREE.Light).isLight
      ) {
        excluded.push(object);
      }
      // Reserve one upper rack slot for the incoming pallet.
      if (object.name.startsWith("Loaded_pallet")) {
        const center = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
        const receivingOrAssembly = center.z > 5 && center.x > -12;
        const reservedBin = center.x > 4 && center.x < 8 && center.z > -8 && center.z < -2 && center.y > 2.5 && center.y < 5.3;
        if (receivingOrAssembly || reservedBin) excluded.push(object);
      }
      if ((object as THREE.Mesh).isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    excluded.forEach((object) => object.removeFromParent());
    return clone;
  }, [scene]);

  return (
    <group name="imported-kaizenx-warehouse" position={[-1.5, 0, -45]} dispose={null}>
      <primitive object={model} />
    </group>
  );
}

useGLTF.preload(warehouseUrl);
