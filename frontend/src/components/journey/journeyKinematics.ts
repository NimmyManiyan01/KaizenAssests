// Pure mathematical kinematics for warehouse journey actors
// Preserves 100% of the original movement paths and stage transitions

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
    const approach = smoothstep(0, 0.012, inboundProgress);
    const departure = smoothstep(0.034, 0.09, inboundProgress);
    barrier1Open = smoothstep(0.014, 0.032, inboundProgress);
    truck1Pos = [
      lerp(0.8, 0, departure),
      0,
      inboundProgress < 0.034 ? lerp(23, 21.5, approach) : lerp(21.5, -4, departure),
    ];
    truck1Rot = [0, Math.PI, 0];
    wheelRot = (23 - truck1Pos[2]) / 0.49;
  } else if (inboundProgress < 0.11) {
    const t = smoothstep(0.09, 0.11, inboundProgress);
    barrier1Open = 1;
    truck1Pos = [0, 0, lerp(-4, -10, t)];
    truck1Rot = [0, Math.PI, 0];
    wheelRot = (23 - truck1Pos[2]) / 0.49;
  } else if (inboundProgress < 0.145) {
    const angle = smoothstep(0.11, 0.145, inboundProgress) * Math.PI;
    barrier1Open = 1;
    truck1Pos = [-4.25 + 4.25 * Math.cos(angle), 0, -10 - 4.25 * Math.sin(angle)];
    truck1Rot = [0, Math.PI + angle, 0];
    wheelRot = (33 + 4.25 * angle) / 0.49;
    dockDoorOpen = smoothstep(0.12, 0.145, inboundProgress);
  } else if (inboundProgress < 0.1667) {
    const t = smoothstep(0.145, 0.1667, inboundProgress);
    isReversing = true;
    barrier1Open = 1;
    truck1Pos = [-8.5, 0, lerp(-10, -17.5, t)];
    truck1Rot = [0, Math.PI * 2, 0];
    wheelRot = (33 + 4.25 * Math.PI - 7.5 * t) / 0.49;
    dockDoorOpen = 1;
  } else {
    barrier1Open = 1;
    truck1Pos = [-8.5, 0, -17.5];
    truck1Rot = [0, Math.PI * 2, 0];
    wheelRot = (33 + 4.25 * Math.PI - 7.5) / 0.49;
    dockDoorOpen = 1;
    truck1Doors = smoothstep(0.1667, 0.185, inboundProgress);
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

  if (scrollProgress < 0.1667) {
    inspectorPos = [-6.6, 1.25, -23.8];
    inspectorRot = [0, -Math.PI / 2, 0];
    inspectProgress = 0;
  } else if (scrollProgress < 0.22) {
    inspectorPos = [-6.6, 1.25, -23.8];
    inspectorRot = [0, -Math.PI / 2, 0];
    inspectProgress = smoothstep(0.203, 0.22, scrollProgress);
  } else {
    const stepT = clamp((scrollProgress - 0.22) / 0.025, 0, 1);
    inspectorPos = [lerp(-6.6, -5.8, stepT), 1.25, lerp(-23.8, -22.5, stepT)];
    inspectorRot = [0, lerp(-Math.PI / 2, -Math.PI / 3, stepT), 0];
    inspectProgress = 1;
  }

  // Scene 2 & 3: Forklift & Pallet
  let forkliftPos: [number, number, number] = [-8.5, 0, -30.5];
  let forkliftRot: [number, number, number] = [0, 0, 0];
  const forkLoadOffset = 1.65;
  const palletCarriageOffset = -0.084;
  const pickupLift = (1.25 - palletCarriageOffset - 0.15) / 2.65;
  const shelfPalletY = 1.65;
  const placementLift = (shelfPalletY - palletCarriageOffset - 0.15) / 2.65;
  const raisedLift = (shelfPalletY + 0.15 - palletCarriageOffset - 0.15) / 2.65;
  let forkLiftProgress = 0;
  let palletPos: [number, number, number] = [-8.5, 1.25, -23.8];
  let palletRot: [number, number, number] = [0, 0, 0];

  if (scrollProgress < 0.225) {
    forkliftPos = [-8.5, 0, -30.5];
    forkliftRot = [0, 0, 0];
    forkLiftProgress = 0;
    const unload = smoothstep(0.187, 0.203, scrollProgress);
    const heading = truck1Rot[1];
    palletPos =
      scrollProgress < 0.1667
        ? [truck1Pos[0] - Math.sin(heading) * 3.3, 0.98, truck1Pos[2] - Math.cos(heading) * 3.3]
        : [-8.5, lerp(0.98, 1.25, unload), lerp(-20.8, -23.8, unload)];
    palletRot = scrollProgress < 0.1667 ? truck1Rot : [0, 0, 0];
  } else if (scrollProgress < 0.255) {
    const t = smoothstep(0.225, 0.255, scrollProgress);
    forkliftPos = [-8.5, 0, lerp(-30.5, -25.45, t)];
    forkliftRot = [0, 0, 0];
    forkLiftProgress = lerp(0, pickupLift, smoothstep(0.225, 0.238, scrollProgress));
    palletPos = [-8.5, 1.25, -23.8];
    palletRot = [0, 0, 0];
  } else if (scrollProgress < 0.275) {
    const t = smoothstep(0.255, 0.275, scrollProgress);
    forkliftPos = [-8.5, 0, -25.45];
    forkliftRot = [0, 0, 0];
    forkLiftProgress = lerp(pickupLift, 0.52, t);
    palletPos = [-8.5, 0.15 + forkLiftProgress * 2.65, -23.8];
    palletRot = [0, 0, 0];
  } else if (scrollProgress < 0.287) {
    const t = smoothstep(0.275, 0.287, scrollProgress);
    forkliftPos = [-8.5, 0, lerp(-25.45, -31, t)];
    forkliftRot = [0, 0, 0];
    forkLiftProgress = 0.52;
  } else if (scrollProgress < 0.305) {
    const t = smoothstep(0.287, 0.305, scrollProgress);
    forkliftPos = [lerp(-8.5, -3.5, t), 0, lerp(-31, -33, t)];
    forkliftRot = [0, Math.PI * t, 0];
    forkLiftProgress = lerp(0.52, 0.12, t);
  } else if (scrollProgress < 0.345) {
    const t = smoothstep(0.305, 0.345, scrollProgress);
    const lateral = t * t * (3 - 2 * t);
    forkliftPos = [lerp(-3.5, 3.8, lateral), 0, lerp(-33, -68, t)];
    const heading = Math.atan2(7.3 * 6 * t * (1 - t), -35);
    forkliftRot = [0, heading, 0];
    forkLiftProgress = 0.12;
    palletPos = [forkliftPos[0], 0.15 + forkLiftProgress * 2.65, forkliftPos[2] - 1.5];
    palletRot = [0, Math.PI, 0];
  } else if (scrollProgress < 0.365) {
    const t = smoothstep(0.345, 0.365, scrollProgress);
    forkliftPos = [lerp(3.8, 4.2, t), 0, -68.0];
    const rotY = lerp(Math.PI, Math.PI / 2, t);
    forkliftRot = [0, rotY, 0];
    forkLiftProgress = 0.12;
    palletPos = [
      forkliftPos[0] + Math.sin(rotY) * 1.5,
      0.15 + forkLiftProgress * 2.65,
      forkliftPos[2] + Math.cos(rotY) * 1.5,
    ];
    palletRot = [0, rotY, 0];
  } else if (scrollProgress < 0.375) {
    forkliftPos = [4.2, 0, -68];
    forkliftRot = [0, Math.PI / 2, 0];
    forkLiftProgress = lerp(0.12, raisedLift, smoothstep(0.365, 0.375, scrollProgress));
  } else if (scrollProgress < 0.385) {
    forkliftPos = [lerp(4.2, 6.35, smoothstep(0.375, 0.385, scrollProgress)), 0, -68];
    forkliftRot = [0, Math.PI / 2, 0];
    forkLiftProgress = raisedLift;
  } else if (scrollProgress < 0.39) {
    forkliftPos = [6.35, 0, -68];
    forkliftRot = [0, Math.PI / 2, 0];
    forkLiftProgress = lerp(raisedLift, placementLift, smoothstep(0.385, 0.39, scrollProgress));
  } else {
    const clearRack = smoothstep(0.39, 0.415, scrollProgress);
    const forwardTurn = smoothstep(0.415, 0.44, scrollProgress);
    let onwardX = lerp(6.35, 3.5, clearRack);
    let onwardZ = -68;
    if (scrollProgress >= 0.44 && scrollProgress < 0.48) {
      onwardX = 3.5;
      onwardZ = lerp(-68, -90, smoothstep(0.44, 0.48, scrollProgress));
    } else if (scrollProgress < 0.51 && scrollProgress >= 0.48) {
      const gapApproach = smoothstep(0.48, 0.51, scrollProgress);
      onwardX = lerp(3.5, 8, gapApproach);
      onwardZ = lerp(-90, -104, gapApproach);
    } else if (scrollProgress < 0.53 && scrollProgress >= 0.51) {
      onwardX = 8;
      onwardZ = lerp(-104, -112, smoothstep(0.51, 0.53, scrollProgress));
    } else if (scrollProgress < 0.56 && scrollProgress >= 0.53) {
      const laneChange = smoothstep(0.53, 0.56, scrollProgress);
      onwardX = lerp(8, 0, laneChange);
      onwardZ = lerp(-112, -121, laneChange);
    } else if (scrollProgress >= 0.56 && scrollProgress < 0.6) {
      onwardX = 0;
      onwardZ = lerp(-121, -145, smoothstep(0.56, 0.6, scrollProgress));
    } else if (scrollProgress >= 0.6) {
      const assemblyApproach = smoothstep(0.6, 0.625, scrollProgress);
      onwardX = lerp(0, 3.5, assemblyApproach);
      onwardZ = lerp(-145, -157, assemblyApproach);
    }
    forkliftPos = [onwardX, 0, onwardZ];
    forkliftRot = [0, lerp(Math.PI / 2, Math.PI, forwardTurn), 0];
    forkLiftProgress = lerp(placementLift, 0.12, smoothstep(0.415, 0.45, scrollProgress));
    palletPos = [8, shelfPalletY, -68];
    palletRot = [0, Math.PI / 2, 0];
  }

  const palletOnForks = scrollProgress >= 0.255 && scrollProgress < 0.39;
  if (palletOnForks) {
    const heading = forkliftRot[1];
    palletPos = [
      forkliftPos[0] + Math.sin(heading) * forkLoadOffset,
      0.15 + forkLiftProgress * 2.65 + palletCarriageOffset,
      forkliftPos[2] + Math.cos(heading) * forkLoadOffset,
    ];
    palletRot = [...forkliftRot];
  }

  // Issued pallet
  const issuedMaterialVisible = scrollProgress >= 0.415 && scrollProgress < 0.75;
  const issuedHeading = forkliftRot[1];
  const issuedPalletOnForks: [number, number, number] = [
    forkliftPos[0] + Math.sin(issuedHeading) * forkLoadOffset,
    0.15 + forkLiftProgress * 2.65 + palletCarriageOffset,
    forkliftPos[2] + Math.cos(issuedHeading) * forkLoadOffset,
  ];
  const assemblyHandoff = smoothstep(0.625, 0.64, scrollProgress);
  const issuedPalletPos: [number, number, number] = [
    lerp(issuedPalletOnForks[0], 1.8, assemblyHandoff),
    lerp(issuedPalletOnForks[1], 1.05, assemblyHandoff),
    lerp(issuedPalletOnForks[2], -160.5, assemblyHandoff),
  ];
  const issuedPalletRot: [number, number, number] = [0, lerp(issuedHeading, 0, assemblyHandoff), 0];

  // Holographic scan & bounding box at rack
  const showLaserScan = scrollProgress >= 0.365;
  const laserScanY = Math.sin(scrollProgress * 60) * 0.4;
  const binColor = scrollProgress >= 0.39 ? "#10b981" : "#06b6d4";
  const binOpacity = scrollProgress >= 0.39 ? 0.85 : 0.45;

  // Outbound trailer
  const departureDoors = 1 - smoothstep(0.925, 0.938, scrollProgress);
  let truckExitPos: [number, number, number] = [-8.5, 0, -204.5];
  let departureHeading = 0;
  let departureDistance = 0;
  const turnRadius = 4.65;
  const barrier2Open = smoothstep(0.978, 0.986, scrollProgress);

  if (scrollProgress < 0.95) {
    const distance = 7.5 * smoothstep(0.938, 0.95, scrollProgress);
    truckExitPos = [-8.5, 0, -204.5 + distance];
    departureDistance = distance;
  } else if (scrollProgress < 0.965) {
    const angle = Math.PI * smoothstep(0.95, 0.965, scrollProgress);
    truckExitPos = [
      -8.5 + turnRadius * (1 - Math.cos(angle)),
      0,
      -197 + turnRadius * Math.sin(angle),
    ];
    departureHeading = angle;
    departureDistance = 7.5 + turnRadius * angle;
  } else {
    departureHeading = Math.PI;
    const approach = 47 * smoothstep(0.965, 0.98, scrollProgress);
    const exit = 26 * smoothstep(0.986, 1, scrollProgress);
    truckExitPos = [0.8, 0, -197 - approach - exit];
    departureDistance = 7.5 + Math.PI * turnRadius + approach + exit;
  }

  // Outbound pallets
  const outboundLoad1 = smoothstep(0.895, 0.91, scrollProgress);
  const outboundLoad2 = smoothstep(0.91, 0.925, scrollProgress);
  const truckLocalPoint = (
    localX: number,
    localY: number,
    localZ: number,
  ): [number, number, number] => [
    truckExitPos[0] + localX * Math.cos(departureHeading) + localZ * Math.sin(departureHeading),
    localY,
    truckExitPos[2] - localX * Math.sin(departureHeading) + localZ * Math.cos(departureHeading),
  ];
  const loadedPallet1 = truckLocalPoint(-0.42, 1.05, -2.8);
  const loadedPallet2 = truckLocalPoint(0.42, 1.05, -0.8);
  const outboundPallet1Pos: [number, number, number] = [
    lerp(-8.5, loadedPallet1[0], outboundLoad1),
    lerp(1.25, loadedPallet1[1], outboundLoad1),
    lerp(-210, loadedPallet1[2], outboundLoad1),
  ];
  const outboundPallet2Pos: [number, number, number] = [
    lerp(-6, loadedPallet2[0], outboundLoad2),
    lerp(1.25, loadedPallet2[1], outboundLoad2),
    lerp(-210, loadedPallet2[2], outboundLoad2),
  ];
  const dispatchLoading = scrollProgress >= 0.89 && scrollProgress < 0.928;
  const activeOutboundPallet = scrollProgress < 0.91 ? outboundPallet1Pos : outboundPallet2Pos;
  const dispatchLoaderPos: [number, number, number] = [
    activeOutboundPallet[0],
    0,
    Math.min(activeOutboundPallet[2] - 1.65, -211.2),
  ];

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
