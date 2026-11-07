import { memo, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { GateBarrier } from "./models/GateBarrier";
import { LogisticsTruck } from "./models/LogisticsTruck";
import { DockInspector } from "./models/DockInspector";
import { PalletAndCargo } from "./models/PalletAndCargo";
import { WarehouseForklift } from "./models/WarehouseForklift";
import { SupplierAsnEnvelope } from "./models/SupplierAsnEnvelope";
import { journeyStore } from "./journeyStore";
import { computeJourneyKinematics } from "./journeyKinematics";
import { supplierJourney } from "./supplierJourney";

interface DynamicActorsProps {
  manualTruckOffset: { x: number; z: number };
  selectedAsn?: any;
}

function DynamicActorsComponent({ manualTruckOffset, selectedAsn }: DynamicActorsProps) {
  // Direct Three.js Object3D references for 60fps zero-reconciliation updates
  const truck1Ref = useRef<THREE.Group>(null);
  const inspectorRef = useRef<THREE.Group>(null);
  const palletRef = useRef<THREE.Group>(null);
  const forkliftRef = useRef<THREE.Group>(null);
  const issuedPalletRef = useRef<THREE.Group>(null);
  const laserScanRef = useRef<THREE.Group>(null);
  const laserScanBeamRef = useRef<THREE.Mesh>(null);
  const laserScanPlaneMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const truckExitRef = useRef<THREE.Group>(null);
  const outboundPallet1Ref = useRef<THREE.Group>(null);
  const outboundPallet2Ref = useRef<THREE.Group>(null);
  const dispatchLoaderRef = useRef<THREE.Group>(null);
  const envelopeGroupRef = useRef<THREE.Group>(null);

  // Mutable animation state references passed down to child actors
  const barrier1OpenRef = useRef(0);
  const barrier2OpenRef = useRef(0);
  const inspectProgressRef = useRef(0);
  const forkliftLiftRef = useRef(0);
  const truck1AnimRef = useRef({ doorsOpenProgress: 0, wheelRotation: 0, isReversing: false });
  const truckExitAnimRef = useRef({ doorsOpenProgress: 0, wheelRotation: 0, isReversing: false });

  // Compute static baseline for initial mount layout
  const init = useMemo(
    () => computeJourneyKinematics(0, 0, 0, undefined, manualTruckOffset),
    [manualTruckOffset],
  );

  useFrame(() => {
    const sp = journeyStore.scrollProgress;
    const sup = journeyStore.supplierProgress;
    const jp = journeyStore.progress;

    const supplier = jp < 0.12 ? supplierJourney(sup) : undefined;
    const kin = computeJourneyKinematics(sp, sup, jp, supplier, manualTruckOffset);

    // Update child actor animation references
    barrier1OpenRef.current = kin.barrier1Open;
    barrier2OpenRef.current = kin.barrier2Open;
    inspectProgressRef.current = kin.inspectProgress;
    forkliftLiftRef.current = kin.forkLiftProgress;

    truck1AnimRef.current.doorsOpenProgress = kin.truck1Doors;
    truck1AnimRef.current.wheelRotation = kin.wheelRot;
    truck1AnimRef.current.isReversing = kin.isReversing;

    truckExitAnimRef.current.doorsOpenProgress = kin.departureDoors;
    truckExitAnimRef.current.wheelRotation = kin.departureDistance / 0.49;
    truckExitAnimRef.current.isReversing = false;

    // Mutate Three.js Object3D scene graph transforms directly (0ms, 0 allocations, 0 React reconciliation)
    if (envelopeGroupRef.current) {
      envelopeGroupRef.current.visible = jp < 0.12;
    }

    if (truck1Ref.current) {
      truck1Ref.current.position.set(kin.truck1Pos[0], kin.truck1Pos[1], kin.truck1Pos[2]);
      truck1Ref.current.rotation.set(kin.truck1Rot[0], kin.truck1Rot[1], kin.truck1Rot[2]);
    }

    if (inspectorRef.current) {
      inspectorRef.current.position.set(kin.inspectorPos[0], kin.inspectorPos[1], kin.inspectorPos[2]);
      inspectorRef.current.rotation.set(kin.inspectorRot[0], kin.inspectorRot[1], kin.inspectorRot[2]);
    }

    if (palletRef.current) {
      palletRef.current.position.set(kin.palletPos[0], kin.palletPos[1], kin.palletPos[2]);
      palletRef.current.rotation.set(kin.palletRot[0], kin.palletRot[1], kin.palletRot[2]);
    }

    if (forkliftRef.current) {
      forkliftRef.current.position.set(kin.forkliftPos[0], kin.forkliftPos[1], kin.forkliftPos[2]);
      forkliftRef.current.rotation.set(kin.forkliftRot[0], kin.forkliftRot[1], kin.forkliftRot[2]);
    }

    if (issuedPalletRef.current) {
      issuedPalletRef.current.position.set(kin.issuedPalletPos[0], kin.issuedPalletPos[1], kin.issuedPalletPos[2]);
      issuedPalletRef.current.rotation.set(kin.issuedPalletRot[0], kin.issuedPalletRot[1], kin.issuedPalletRot[2]);
      issuedPalletRef.current.visible = kin.issuedMaterialVisible;
    }

    if (laserScanRef.current) {
      laserScanRef.current.visible = kin.showLaserScan;
      if (laserScanBeamRef.current) {
        laserScanBeamRef.current.position.y = kin.laserScanY;
        laserScanBeamRef.current.visible = sp < 0.39;
      }
      if (laserScanPlaneMatRef.current) {
        laserScanPlaneMatRef.current.opacity = kin.binOpacity;
        laserScanPlaneMatRef.current.color.set(kin.binColor);
      }
    }

    if (truckExitRef.current) {
      truckExitRef.current.position.set(kin.truckExitPos[0], kin.truckExitPos[1], kin.truckExitPos[2]);
      truckExitRef.current.rotation.set(0, kin.departureHeading, 0);
    }

    if (outboundPallet1Ref.current) {
      outboundPallet1Ref.current.position.set(kin.outboundPallet1Pos[0], kin.outboundPallet1Pos[1], kin.outboundPallet1Pos[2]);
    }

    if (outboundPallet2Ref.current) {
      outboundPallet2Ref.current.position.set(kin.outboundPallet2Pos[0], kin.outboundPallet2Pos[1], kin.outboundPallet2Pos[2]);
    }

    if (dispatchLoaderRef.current) {
      dispatchLoaderRef.current.position.set(kin.dispatchLoaderPos[0], kin.dispatchLoaderPos[1], kin.dispatchLoaderPos[2]);
      dispatchLoaderRef.current.visible = kin.dispatchLoading;
    }
  });

  return (
    <group name="dynamic-journey-actors">
      {/* Supplier ASN story: sent, carried to security, then opened */}
      <group ref={envelopeGroupRef} visible={true}>
        <SupplierAsnEnvelope
          progress={journeyStore.supplierProgress}
          asn={selectedAsn}
        />
      </group>

      {/* ─── SCENE 1: INBOUND GATE ENTRY ─── */}
      <GateBarrier
        position={[0, 0, 15]}
        barrierOpenProgress={init.barrier1Open}
        openProgressRef={barrier1OpenRef}
        securitySide="left"
      />

      {/* ─── SCENE 1 & 2: INBOUND LOGISTICS TRUCK (FL-8820) ─── */}
      <group ref={truck1Ref} position={init.truck1Pos} rotation={init.truck1Rot}>
        <LogisticsTruck
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
          doorsOpenProgress={init.truck1Doors}
          wheelRotation={init.wheelRot}
          isReversing={init.isReversing}
          animRef={truck1AnimRef}
        />
      </group>

      {/* Warehouse Inspector: The man checking goods list before forklift pick */}
      <group ref={inspectorRef} position={init.inspectorPos} rotation={init.inspectorRot}>
        <DockInspector
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
          inspectionProgress={init.inspectProgress}
          inspectionProgressRef={inspectProgressRef}
        />
      </group>

      {/* ─── SCENE 2 & 3: DYNAMIC RECEIVED GOODS PALLET ─── */}
      <group ref={palletRef} position={init.palletPos} rotation={init.palletRot}>
        <PalletAndCargo
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
          hasCargo={true}
          boxCount={8}
          showQr={true}
        />
      </group>

      {/* Putaway Forklift */}
      <group ref={forkliftRef} position={init.forkliftPos} rotation={init.forkliftRot}>
        <WarehouseForklift
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
          forkLiftProgress={init.forkLiftProgress}
          liftProgressRef={forkliftLiftRef}
        />
      </group>

      {/* Issued Material Pallet */}
      <group
        ref={issuedPalletRef}
        position={init.issuedPalletPos}
        rotation={init.issuedPalletRot}
        visible={init.issuedMaterialVisible}
      >
        <PalletAndCargo
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
          hasCargo
          boxCount={6}
          showQr
        />
      </group>

      {/* Holographic Laser Scanner at Rack Bay 1 (3D bounding wireframe & laser line) */}
      <group ref={laserScanRef} position={[7.4, 2.5, -68.0]} visible={init.showLaserScan}>
        <mesh rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[1.5, 1.3]} />
          <meshBasicMaterial
            ref={laserScanPlaneMatRef}
            color={init.binColor}
            wireframe
            transparent
            opacity={init.binOpacity}
          />
        </mesh>
        <mesh
          ref={laserScanBeamRef}
          position={[0.02, init.laserScanY, 0]}
          rotation={[0, -Math.PI / 2, 0]}
          visible={true}
        >
          <planeGeometry args={[1.4, 0.03]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.9} />
        </mesh>
      </group>

      {/* ─── SCENE 6: OUTBOUND DISPATCH TRUCK & PALLETS ─── */}
      <group ref={truckExitRef} position={init.truckExitPos} rotation={[0, init.departureHeading, 0]}>
        <LogisticsTruck
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
          doorsOpenProgress={init.departureDoors}
          wheelRotation={init.departureDistance / 0.49}
          animRef={truckExitAnimRef}
        />
      </group>

      <group ref={outboundPallet1Ref} position={init.outboundPallet1Pos}>
        <PalletAndCargo position={[0, 0, 0]} isWrapped boxCount={8} />
      </group>

      <group ref={outboundPallet2Ref} position={init.outboundPallet2Pos}>
        <PalletAndCargo position={[0, 0, 0]} isWrapped boxCount={8} />
      </group>

      <group
        ref={dispatchLoaderRef}
        position={init.dispatchLoaderPos}
        rotation={[0, 0, 0]}
        visible={init.dispatchLoading}
      >
        <WarehouseForklift
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
          forkLiftProgress={0.34}
        />
      </group>

      {/* ─── SCENE 7: DEPARTURE GATE EXIT ─── */}
      <GateBarrier
        position={[0, 0, -252]}
        barrierOpenProgress={init.barrier2Open}
        openProgressRef={barrier2OpenRef}
        gateType="exit"
      />
    </group>
  );
}

export const DynamicActors = memo(DynamicActorsComponent);
