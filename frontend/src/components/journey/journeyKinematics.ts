// Pure mathematical kinematics for warehouse journey actors
// Receiving, storage and dispatch match the imported KaizenX warehouse.

export interface KinematicsResult {
  // Inbound truck
  truck1Pos: [number, number, number];
  truck1Rot: [number, number, number];
  barrier1Open: number;
  dockDoorOpen: number;
  truck1Doors: number;
  wheelRot: number;
  isReversing: boolean;

  // Dock inspector
  inspectorPos: [number, number, number];
  inspectorRot: [number, number, number];
  inspectProgress: number;

  // Inbound forklift & pallet
  forkliftPos: [number, number, number];
  forkliftRot: [number, number, number];
  forkLiftProgress: number;
  palletPos: [number, number, number];
  palletRot: [number, number, number];

  // Issued material pallet
  issuedMaterialVisible: boolean;
  issuedPalletPos: [number, number, number];
  issuedPalletRot: [number, number, number];

  // Laser scanner at rack
  showLaserScan: boolean;
  laserScanY: number;
  binColor: string;
  binOpacity: number;

  // Outbound trailer & dispatch
  departureDoors: number;
  truckExitPos: [number, number, number];
  departureHeading: number;
  departureDistance: number;
  barrier2Open: number;
  outboundPallet1Pos: [number, number, number];
  outboundPallet2Pos: [number, number, number];
  dispatchLoading: boolean;
  dispatchLoaderPos: [number, number, number];
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

function smoothstep(min: number, max: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

// $C^2$ continuous smootherstep for zero acceleration & jerk at endpoints
function smootherstep(min: number, max: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function easeInQuad(min: number, max: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x;
}

function easeOutQuad(min: number, max: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * (2 - x);
}

function easeInOutCubic(min: number, max: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function computeJourneyKinematics(
  scrollProgress: number,
  supplierProgress: number,
  journeyProgress: number,
  supplierData?: { truck: { x: number; z: number }; heading: number; wheels: number },
  manualTruckOffset: { x: number; z: number } = { x: 0, z: 0 },
): KinematicsResult {
  // Inbound truck
  let truck1Pos: [number, number, number] = [0.8, 0, 16.5];
  let truck1Rot: [number, number, number] = [0, Math.PI, 0];
  let barrier1Open = 0;
  let dockDoorOpen = 0;
  let truck1Doors = 0;
  let wheelRot = 0;
  let isReversing = false;

  const inboundProgress = scrollProgress;

  if (inboundProgress < 0.09) {
    // 1. Close truck approach with smooth braking deceleration to security gate (0.00 -> 0.030)
    const approach = smootherstep(0, 0.03, inboundProgress);
    // 2. Engine acceleration through opened gate into facility (0.090 -> 0.110)
    const departure = easeInQuad(0.09, 0.11, inboundProgress);

    // Barrier opens smoothly ONLY after check-in stop at checkpoint (0.065 -> 0.090)
    barrier1Open = smootherstep(0.065, 0.09, inboundProgress);

    let zPos = lerp(23, 21.5, approach);
    if (inboundProgress >= 0.09) {
      zPos = lerp(21.5, -4.0, departure);
    }

    truck1Pos = [
      lerp(0.8, 0, departure),
      0,
      zPos,
    ];
    truck1Rot = [0, Math.PI, 0];
  } else if (inboundProgress < 0.11) {
    const t = smootherstep(0.09, 0.11, inboundProgress);
    barrier1Open = 1;
    truck1Pos = [lerp(0.8, 0, t), 0, lerp(21.5, -10, t)];
    truck1Rot = [0, Math.PI, 0];
    wheelRot = (29.5 - truck1Pos[2]) / 0.49;
  } else if (inboundProgress < 0.145) {
    const angle = easeInOutCubic(0.11, 0.145, inboundProgress) * Math.PI;
    barrier1Open = 1;
    truck1Pos = [-4.25 + 4.25 * Math.cos(angle), 0, -10 - 4.25 * Math.sin(angle)];
    truck1Rot = [0, Math.PI + angle, 0];
    wheelRot = (33 + 4.25 * angle) / 0.49;
    dockDoorOpen = smootherstep(0.13, 0.155, inboundProgress);
  } else if (inboundProgress < 0.165) {
    const t = easeInOutCubic(0.145, 0.165, inboundProgress);
    isReversing = true;
    barrier1Open = 1;
    truck1Pos = [-8.5, 0, lerp(-10, -17.5, t)];
    truck1Rot = [0, Math.PI * 2, 0];
    wheelRot = (33 + 4.25 * Math.PI - 7.5 * t) / 0.49;
    dockDoorOpen = 1;
  } else {
    // Docking complete: Truck stopped in marked Bay D-04 (-8.5, 0, -17.5)
    barrier1Open = 1;
    truck1Pos = [-8.5, 0, -17.5];
    truck1Rot = [0, Math.PI * 2, 0];
    wheelRot = (33 + 4.25 * Math.PI - 7.5) / 0.49;
    dockDoorOpen = 1;
    truck1Doors = smootherstep(0.165, 0.188, inboundProgress);
  }

  truck1Pos = [
    truck1Pos[0] + manualTruckOffset.x,
    truck1Pos[1],
    truck1Pos[2] + manualTruckOffset.z,
  ];

  if (journeyProgress < 0.12 && supplierData) {
    truck1Pos = [supplierData.truck.x, 0, supplierData.truck.z];
    truck1Rot = [0, supplierData.heading, 0];
    wheelRot = supplierData.wheels;
  }

  // Scene 2: Dock Inspector
  let inspectorPos: [number, number, number] = [-6.6, 1.25, -23.8];
  let inspectorRot: [number, number, number] = [0, -Math.PI / 2, 0];
  let inspectProgress = 0;

  if (scrollProgress < 0.165) {
    inspectorPos = [-6.6, 1.25, -23.8];
    inspectorRot = [0, -Math.PI / 2, 0];
    inspectProgress = 0;
  } else if (scrollProgress < 0.22) {
    inspectorPos = [-6.6, 1.25, -23.8];
    inspectorRot = [0, -Math.PI / 2, 0];
    inspectProgress = smootherstep(0.185, 0.22, scrollProgress);
  } else {
    const stepT = clamp((scrollProgress - 0.22) / 0.025, 0, 1);
    inspectorPos = [lerp(-6.6, -5.8, stepT), 1.25, lerp(-23.8, -22.5, stepT)];
    inspectorRot = [0, lerp(-Math.PI / 2, -Math.PI / 3, stepT), 0];
    inspectProgress = 1;
  }

  // Imported warehouse floor, upper storage shelf and dock approach, in metres.
  const floor = 1.12, shelfY = 3.3775;
  const pickupLift = (1.5 - floor - 0.066) / 2.65;
  const shelfLift = (shelfY - floor - 0.066) / 2.65;
  const p = scrollProgress;
  type Point = [number, number, number];
  const move = (
    a: Point,
    b: Point,
    start: number,
    end: number,
    easeFn: (min: number, max: number, val: number) => number = easeInOutCubic,
  ): Point => {
    const t = easeFn(start, end, p);
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  };
  let forkliftPos: Point = [-8.5, floor, -30];
  let heading = 0, forkLiftProgress = pickupLift;
  if (p < .180) {
    forkliftPos = [-8.5, floor, -30];
  } else if (p < .215) {
    forkliftPos = move([-8.5, floor, -30], [-8.5, floor, -25.2], .180, .215, easeInOutCubic);
  } else if (p < .255) {
    forkliftPos = move([-8.5, floor, -25.2], [-8.5, floor, -28.5], .215, .255, smootherstep);
  } else if (p < .285) {
    forkliftPos = move([-8.5, floor, -28.5], [-8.5, floor, -33], .255, .285, easeOutQuad);
  } else if (p < .31) {
    forkliftPos = move([-8.5, floor, -33], [.5, floor, -33], .285, .31, easeInOutCubic);
    heading = lerp(0, Math.PI, easeInOutCubic(.285, .31, p));
  } else if (p < .355) {
    forkliftPos = move([.5,floor,-33],[.5,floor,-50],.31,.355, smootherstep); heading = Math.PI;
  } else if (p < .39) {
    forkliftPos = move([.5,floor,-50],[2.6,floor,-50],.375,.385, easeInOutCubic);
    heading = lerp(Math.PI,Math.PI/2,easeInOutCubic(.355,.37,p));
    forkLiftProgress = lerp(pickupLift,shelfLift,easeInOutCubic(.365,.375,p));
  } else if (p < .44) {
    forkliftPos = move([2.6,floor,-50],[.5,floor,-50],.395,.415, easeInOutCubic); heading = Math.PI/2;
    forkLiftProgress = lerp(shelfLift,.12,easeInOutCubic(.415,.44,p));
  } else if (p < .52) {
    forkliftPos = [.5,floor,-50]; heading = Math.PI/2;
    forkLiftProgress = lerp(.12,shelfLift,easeInOutCubic(.48,.51,p));
  } else if (p < .56) {
    forkliftPos = move([.5,floor,-50],[2.6,floor,-50],.52,.54, easeInOutCubic); heading = Math.PI/2; forkLiftProgress=shelfLift;
  } else if (p < .59) {
    forkliftPos=move([2.6,floor,-50],[.5,floor,-50],.56,.59, easeInOutCubic); heading=Math.PI/2;
    forkLiftProgress=lerp(shelfLift,.12,easeInOutCubic(.56,.59,p));
  } else if (p < .625) {
    forkliftPos=move([.5,floor,-50],[.5,floor,-30],.59,.625, smootherstep);
    heading=lerp(Math.PI/2,0,easeInOutCubic(.59,.60,p));forkLiftProgress=.12;
  } else {
    // Stop alongside the assembly platform, not inside its machinery.
    forkliftPos=move([.5,floor,-30],[8,floor,-28.5],.625,.65, easeOutQuad);
    heading=lerp(0,Math.PI/2,easeInOutCubic(.625,.64,p));forkLiftProgress=.12;
  }
  const forkliftRot: Point=[0,heading,0];
  const onForks: Point=[forkliftPos[0]+Math.sin(heading)*1.65,floor+.066+forkLiftProgress*2.65,forkliftPos[2]+Math.cos(heading)*1.65];
  let palletPos: Point = move([-8.5,1.5,-21],[-8.5,1.5,-25.2],.180,.215, easeInOutCubic);
  let palletRot: Point=[0,0,0];
  if (p>=.215 && p<.39) {palletPos=[...onForks];palletRot=[...forkliftRot];}
  if (p>=.39) {palletPos=[4.25,shelfY,-50];palletRot=[0,Math.PI/2,0];}
  const issuedMaterialVisible=p>=.55 && p<.72;
  const issuedPalletPos: Point=move(onForks,[13.6,2.17,-28.5],.65,.68, easeInOutCubic);
  const issuedPalletRot: Point=[0,lerp(heading,0,easeInOutCubic(.65,.68,p)),0];
  const showLaserScan=p>=.365 && p<.55;
  const laserScanY=Math.sin(p*60)*.4;
  const binColor=p>=.39?'#10b981':'#06b6d4';
  const binOpacity=p>=.39?.85:.45;
  // Front-right Bay 05 / Bay 12 outbound vehicle departure & exit checkpoint
  const departureDoors = 1 - smootherstep(0.915, 0.935, p);
  const departureHeading = 0;
  const departureDistance = 65 * easeInQuad(0.930, 0.985, p);
  const truckExitPos: Point = [18.5, 0, -17.5 + departureDistance];
  const barrier2Open = smootherstep(0.945, 0.965, p);
  const load1 = smootherstep(0.85, 0.885, p);
  const load2 = smootherstep(0.885, 0.915, p);
  const outboundPallet1Pos: Point = [18.1, lerp(1.12, 1.5, load1), lerp(-27, truckExitPos[2] - 2.8, load1)];
  const outboundPallet2Pos: Point = [19, lerp(1.12, 1.5, load2), lerp(-29, truckExitPos[2] - 0.8, load2)];
  const dispatchLoading = p >= 0.85 && p < 0.915;
  const active = p < 0.885 ? outboundPallet1Pos : outboundPallet2Pos;
  const dispatchLoaderPos: Point = [active[0], floor, Math.min(active[2] - 1.65, -27)];
  return {
    truck1Pos,
    truck1Rot,
    barrier1Open,
    dockDoorOpen,
    truck1Doors,
    wheelRot,
    isReversing,
    inspectorPos,
    inspectorRot,
    inspectProgress,
    forkliftPos,
    forkliftRot,
    forkLiftProgress,
    palletPos,
    palletRot,
    issuedMaterialVisible,
    issuedPalletPos,
    issuedPalletRot,
    showLaserScan,
    laserScanY,
    binColor,
    binOpacity,
    departureDoors,
    truckExitPos,
    departureHeading,
    departureDistance,
    barrier2Open,
    outboundPallet1Pos,
    outboundPallet2Pos,
    dispatchLoading,
    dispatchLoaderPos,
  };
}
