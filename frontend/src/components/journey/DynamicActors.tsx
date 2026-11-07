import { memo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { GateBarrier } from "./models/GateBarrier";
import { LogisticsTruck } from "./models/LogisticsTruck";
import { DockInspector } from "./models/DockInspector";
import { PalletAndCargo } from "./models/PalletAndCargo";
import { WarehouseForklift } from "./models/WarehouseForklift";
import { SupplierAsnEnvelope } from "./models/SupplierAsnEnvelope";
import { journeyStore } from "./journeyStore";
import { computeJourneyKinematics, type KinematicsResult } from "./journeyKinematics";
import { supplierJourney } from "./supplierJourney";

interface DynamicActorsProps {
  manualTruckOffset: { x: number; z: number };
  selectedAsn?: any;
}

function DynamicActorsComponent({ manualTruckOffset, selectedAsn }: DynamicActorsProps) {
  const [kin, setKin] = useState<KinematicsResult>(() =>
    computeJourneyKinematics(0, 0, 0, undefined, manualTruckOffset)
  );

  const lastProgressRef = useRef(-1);

  useFrame(() => {
    const sp = journeyStore.scrollProgress;
    const sup = journeyStore.supplierProgress;
    const jp = journeyStore.progress;

    // Only update state if progress changed significantly (> 0.0008) to maintain 60fps with zero waste
    if (Math.abs(sp - lastProgressRef.current) > 0.0008) {
      lastProgressRef.current = sp;
      const supplier = jp < 0.12 ? supplierJourney(sup) : undefined;
      const nextKin = computeJourneyKinematics(sp, sup, jp, supplier, manualTruckOffset);
      setKin(nextKin);
    }
  });

  const scrollProgress = journeyStore.scrollProgress;

  return (
    <group name="dynamic-journey-actors">
      {/* Supplier ASN story: sent, carried to security, then opened */}
      <SupplierAsnEnvelope
        progress={journeyStore.supplierProgress}
        visible={journeyStore.progress < 0.12}
        asn={selectedAsn}
      />

      {/* ─── SCENE 1: INBOUND GATE ENTRY ─── */}
      <GateBarrier
        position={[0, 0, 15]}
        barrierOpenProgress={kin.barrier1Open}
        securitySide="left"
      />

      {/* ─── SCENE 1 & 2: INBOUND LOGISTICS TRUCK (FL-8820) ─── */}
      <LogisticsTruck
        position={kin.truck1Pos}
        rotation={kin.truck1Rot}
        doorsOpenProgress={kin.truck1Doors}
        wheelRotation={kin.wheelRot}
        isReversing={kin.isReversing}
      />

      {/* Warehouse Inspector: The man checking goods list before forklift pick */}
      <DockInspector
        position={kin.inspectorPos}
        rotation={kin.inspectorRot}
        inspectionProgress={kin.inspectProgress}
      />

      {/* ─── SCENE 2 & 3: DYNAMIC RECEIVED GOODS PALLET ─── */}
      <PalletAndCargo
        position={kin.palletPos}
        rotation={kin.palletRot}
        hasCargo={true}
        boxCount={8}
        showQr={scrollProgress >= 0.22}
      />

      {/* Putaway Forklift */}
      <WarehouseForklift
        position={kin.forkliftPos}
        rotation={kin.forkliftRot}
        forkLiftProgress={kin.forkLiftProgress}
      />

      {/* Issued Material Pallet */}
      {kin.issuedMaterialVisible && (
        <PalletAndCargo
          position={kin.issuedPalletPos}
          rotation={kin.issuedPalletRot}
          hasCargo
          boxCount={6}
          showQr
        />
      )}

      {/* Holographic Laser Scanner at Rack Bay 1 (3D bounding wireframe & laser line) */}
      {kin.showLaserScan && (
        <group position={[7.4, 2.5, -68.0]}>
          <mesh rotation={[0, -Math.PI / 2, 0]}>
            <planeGeometry args={[1.5, 1.3]} />
            <meshBasicMaterial
              color={kin.binColor}
              wireframe
              transparent
              opacity={kin.binOpacity}
            />
          </mesh>
          {scrollProgress < 0.39 && (
            <mesh
              position={[0.02, kin.laserScanY, 0]}
              rotation={[0, -Math.PI / 2, 0]}
            >
              <planeGeometry args={[1.4, 0.03]} />
              <meshBasicMaterial color="#22d3ee" transparent opacity={0.9} />
            </mesh>
          )}
        </group>
      )}

      {/* ─── SCENE 6: OUTBOUND DISPATCH TRUCK & PALLETS ─── */}
      <LogisticsTruck
        position={kin.truckExitPos}
        rotation={[0, kin.departureHeading, 0]}
        doorsOpenProgress={kin.departureDoors}
        wheelRotation={kin.departureDistance / 0.49}
      />
      <PalletAndCargo position={kin.outboundPallet1Pos} isWrapped boxCount={8} />
      <PalletAndCargo position={kin.outboundPallet2Pos} isWrapped boxCount={8} />

      {kin.dispatchLoading && (
        <WarehouseForklift
          position={kin.dispatchLoaderPos}
          rotation={[0, 0, 0]}
          forkLiftProgress={0.34}
        />
      )}

      {/* ─── SCENE 7: DEPARTURE GATE EXIT ─── */}
      <GateBarrier
        position={[0, 0, -252]}
        barrierOpenProgress={kin.barrier2Open}
        gateType="exit"
      />
    </group>
  );
}

export const DynamicActors = memo(DynamicActorsComponent);
