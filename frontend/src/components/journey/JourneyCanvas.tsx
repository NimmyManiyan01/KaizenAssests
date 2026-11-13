import { memo, Suspense, useEffect, useState, useRef } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { JourneyStage } from "./data/journeyStages";
import { JourneyCamera } from "./JourneyCamera";
import { WarehouseBuilding as WarehouseBuildingModel } from "./models/WarehouseBuilding";
import { LoadingDock as LoadingDockModel } from "./models/LoadingDock";
import { StorageRack as StorageRackModel } from "./models/StorageRack";
import { PalletAndCargo as PalletAndCargoModel } from "./models/PalletAndCargo";
import { ConveyorSystem as ConveyorSystemModel } from "./models/ConveyorSystem";
import { PumpAssemblyCell as PumpAssemblyCellModel } from "./models/PumpAssemblyCell";
import { NatureEnvironment as NatureEnvironmentModel } from "./models/NatureEnvironment";
import { DynamicActors } from "./DynamicActors";
import { StaticBatch } from "./StaticBatch";
import { SceneRuntime } from "./SceneRuntime";

// Compare transform tuples by value so unchanged models skip reconciliation
function sameModelProps(previous: object, next: object) {
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  return (
    Object.keys(before).length === Object.keys(after).length &&
    Object.keys(after).every((key) => {
      const a = before[key],
        b = after[key];
      return (
        Object.is(a, b) ||
        (Array.isArray(a) &&
          Array.isArray(b) &&
          a.length === b.length &&
          a.every((value, index) => Object.is(value, b[index])))
      );
    })
  );
}

const WarehouseBuilding = memo(WarehouseBuildingModel, sameModelProps);
const LoadingDock = memo(LoadingDockModel, sameModelProps);
const StorageRack = memo(StorageRackModel, sameModelProps);
const PalletAndCargo = memo(PalletAndCargoModel, sameModelProps);
const ConveyorSystem = memo(ConveyorSystemModel, sameModelProps);
const PumpAssemblyCell = memo(PumpAssemblyCellModel, sameModelProps);
const NatureEnvironment = memo(NatureEnvironmentModel, sameModelProps);

interface JourneyCanvasProps {
  stages: JourneyStage[];
  activeIndex?: number;
  scrollProgress?: number;
  overviewProgress?: number;
  mouseOffset: { x: number; y: number };
  onSelectStage?: (index: number) => void;
  isFreeOrbit?: boolean;
  selectedAsn?: any;
}

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

export function JourneyCanvas({
  stages,
  mouseOffset,
  isFreeOrbit = false,
  selectedAsn,
}: JourneyCanvasProps) {
  const [manualTruckOffset, setManualTruckOffset] = useState({ x: 0, z: 0 });
  const container = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(true);
  useEffect(() => {
    let inView = true;
    const update = () => setRendering(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      inView = !!entry?.isIntersecting;
      update();
    });
    if (container.current) observer.observe(container.current);
    document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isFreeOrbit) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button, [contenteditable='true']")) return;
      event.preventDefault();
      const step = event.shiftKey ? 1.2 : 0.55;
      setManualTruckOffset((current) => ({
        x: clamp(
          current.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
          -8,
          8,
        ),
        z: clamp(
          current.z + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
          -10,
          10,
        ),
      }));
    };
    window.addEventListener("keydown", handleKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFreeOrbit]);

  return (
    <div ref={container} className="absolute inset-0 z-0 bg-[#e7e9e5] overflow-hidden">
      <Canvas
        frameloop={rendering ? "always" : "never"}
        performance={{ min: 0.65, max: 1, debounce: 250 }}
        camera={{ position: [-6.5, 17.5, 43.5], fov: 48, near: 0.1, far: 4000 }}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          alpha: false,
          stencil: false,
          depth: true,
        }}
        // Stable framebuffer size: changing DPR during a pinned scroll causes
        // GPU reallocations and fights Canvas updates at chapter boundaries.
        dpr={1}
        shadows={{ type: THREE.PCFShadowMap }}
      >
        <color attach="background" args={["#e7e9e5"]} />
        <fog attach="fog" args={["#e7e9e5", 90, 300]} />
        <hemisphereLight args={["#fffaf0", "#7e8580", 0.6]} />

        {/* ─── LIGHTING RIG (DAYLIGHT) ─── */}
        <ambientLight intensity={1.2} color="#ffffff" />
        <directionalLight
          position={[20, 35, 25]}
          intensity={2.2}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-far={180}
          shadow-camera-left={-30}
          shadow-camera-right={30}
          shadow-camera-top={30}
          shadow-camera-bottom={-30}
          shadow-bias={-0.0005}
          color="#fffbeb"
        />

        {/* Key Operational Luminaires */}
        <pointLight position={[0, 8, -30]} intensity={3.5} color="#38bdf8" distance={35} />

        <Suspense fallback={null}>
          <SceneRuntime />
          {/* Nature Environment (Hills, Flat Ground, City) */}
          <StaticBatch><NatureEnvironment /></StaticBatch>

          {/* Camera Controller: Guided 60fps trajectory or Free 3D Orbit */}
          {isFreeOrbit ? (
            <OrbitControls
              makeDefault
              maxPolarAngle={Math.PI / 2.05}
              minDistance={3}
              maxDistance={250}
            />
          ) : (
            <JourneyCamera
              stages={stages}
              mouseOffset={mouseOffset}
            />
          )}

          {/* 3D Dynamic Animated Actors (Decoupled Kinematics) */}
          <DynamicActors
            manualTruckOffset={manualTruckOffset}
            selectedAsn={selectedAsn}
          />

          {/* ─── 3D WAREHOUSE STATIC ENVIRONMENT OBJECTS (NEVER RE-RENDER ON SCROLL) ─── */}
          <StaticBatch><WarehouseBuilding /></StaticBatch>

          {/* Static Receiving Dock 02 */}
          <LoadingDock
            position={[-8.5, 0, -25]}
            doorOpenProgress={1}
            doorNumber="DOCK 02"
            pickupLane
          />

          {/* ─── STORAGE AISLES & INVENTORY MATRIX ─── */}
          <StaticBatch>
          {/* Left Rack Row 1 */}
          <StorageRack
            position={[-7.5, 0, -68]}
            rotation={[0, Math.PI / 2, 0]}
            bays={3}
            tiers={4}
          />
          <StorageRack
            position={[-7.5, 0, -82]}
            rotation={[0, Math.PI / 2, 0]}
            bays={3}
            tiers={4}
          />

          {/* Right Rack Row 1 (Target Aisle) */}
          <StorageRack
            position={[8.0, 0, -68]}
            rotation={[0, -Math.PI / 2, 0]}
            bays={3}
            tiers={4}
          />
          <StorageRack
            position={[8.0, 0, -82]}
            rotation={[0, -Math.PI / 2, 0]}
            bays={3}
            tiers={4}
          />

          {/* High Inventory Overview Rows (Scene 4 Matrix) */}
          <StorageRack position={[-16, 0, -108]} bays={4} tiers={4} />
          <StorageRack position={[0, 0, -108]} bays={4} tiers={4} />
          <StorageRack position={[16, 0, -108]} bays={4} tiers={4} />
          <StorageRack position={[-8, 0, -125]} bays={4} tiers={4} />
          <StorageRack position={[8, 0, -125]} bays={4} tiers={4} />

          {/* Static Stocked Pallets on Shelves */}
          <PalletAndCargo
            position={[8.0, 1.66, -64.8]}
            rotation={[0, Math.PI / 2, 0]}
            boxCount={6}
          />
          <PalletAndCargo
            position={[8.0, 3.46, -71.2]}
            rotation={[0, Math.PI / 2, 0]}
            boxCount={8}
          />
          <PalletAndCargo
            position={[-7.5, 1.66, -68]}
            rotation={[0, Math.PI / 2, 0]}
            boxCount={8}
          />
          <PalletAndCargo
            position={[-7.5, 3.46, -80]}
            rotation={[0, Math.PI / 2, 0]}
            boxCount={6}
          />
          <PalletAndCargo position={[-16, 1.66, -107.3]} rotation={[0, 0, 0]} boxCount={7} />
          <PalletAndCargo position={[-16, 3.46, -107.3]} rotation={[0, 0, 0]} boxCount={5} />
          <PalletAndCargo position={[0, 1.66, -107.3]} rotation={[0, 0, 0]} boxCount={8} />
          <PalletAndCargo position={[16, 3.46, -107.3]} rotation={[0, 0, 0]} boxCount={6} />
          <PalletAndCargo position={[-8, 1.66, -124.3]} rotation={[0, 0, 0]} boxCount={6} />
          <PalletAndCargo position={[8, 3.46, -124.3]} rotation={[0, 0, 0]} boxCount={8} />

          </StaticBatch>
          {/* ─── SCENE 5: PRODUCTION ASSEMBLY ─── */}
          <StaticBatch>
            <ConveyorSystem position={[13.1, 1.12, -29]} length={10} width={1.1} height={0.96} />
          </StaticBatch>
          <PumpAssemblyCell position={[11.95, 1.12, -29]} />

          {/* ─── SCENE 6: OUTBOUND DISPATCH DOCK ─── */}
          <LoadingDock position={[-8.5, 0, -212]} doorOpenProgress={1} doorNumber="BAY 06" />
        </Suspense>
      </Canvas>
    </div>
  );
}
