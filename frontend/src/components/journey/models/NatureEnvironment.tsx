import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createFoliageGeometry, createTreeTexture } from "./treeGeometry";

type Vector = [number, number, number];
type Instance = { position: Vector; scale: Vector; rotation: Vector; color: string };
type Kind = "trunk" | "leaves" | "pine" | "rock";

function smooth(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

// Continuous terrain remains below the entire facility and both vehicle approaches.
function landscapeHeight(x: number, z: number) {
  const sideClearance = smooth((Math.abs(x) - 38) / 34);
  const rearClearance = smooth((-z - 295) / 45);
  const approachClearance = smooth((Math.abs(x) - 10) / 20);
  const clearance = Math.max(sideClearance, rearClearance) * approachClearance;
  const hills = [
    [-125, -65, 30, 68, 100],
    [-145, -230, 43, 85, 110],
    [125, -100, 36, 70, 120],
    [160, -270, 48, 90, 95],
    [-70, -405, 50, 100, 70],
    [85, -430, 64, 105, 85],
  ];
  let height = 0;
  for (const [cx, cz, peak, width, depth] of hills) {
    height += peak * Math.exp(-(((x - cx) / width) ** 2 + ((z - cz) / depth) ** 2));
  }
  const detail = Math.sin(x * 0.055 + z * 0.026) * 2.1 + Math.cos(z * 0.071 - x * 0.023) * 1.2;
  return -0.12 + clearance * Math.max(0, height + detail);
}

function VegetationBatch({ items, kind }: { items: Instance[]; kind: Kind }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    if (kind === "trunk") return new THREE.CylinderGeometry(0.55, 0.85, 1, 8);
    if (kind === "rock") return new THREE.DodecahedronGeometry(1, 1);
    if (kind === "pine") return new THREE.ConeGeometry(1, 1.25, 8);
    return new THREE.IcosahedronGeometry(1, 2); // Solid, volumetric, lush stylized canopy!
  }, [kind]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    items.forEach((item, index) => {
      transform.position.set(...item.position);
      transform.scale.set(...item.scale);
      transform.rotation.set(...item.rotation);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, color.set(item.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);

  return (
    <instancedMesh ref={ref} args={[geometry, undefined, items.length]} castShadow receiveShadow>
      <meshStandardMaterial
        roughness={kind === "rock" ? 0.95 : kind === "trunk" ? 0.9 : 0.82}
        metalness={0.02}
        side={THREE.FrontSide}
      />
    </instancedMesh>
  );
}

// Helper to cleanly separate facility courtyard & roadway from surrounding hill landscape
function isInsideFacility(x: number, z: number): boolean {
  // Main facility courtyard inside white perimeter wall
  if (Math.abs(x) <= 32.2 && z <= 15.2 && z >= -252.2) return true;
  // Front entry road & gate approach
  if (Math.abs(x) <= 6.8 && z > 15.0 && z < 75.0) return true;
  // Rear exit road
  if (Math.abs(x) <= 6.8 && z < -252.0 && z > -295.0) return true;
  return false;
}

// Precision surface normal calculation for hill slope alignment
function getTerrainNormal(x: number, z: number): THREE.Vector3 {
  const eps = 0.75;
  const hL = landscapeHeight(x - eps, z);
  const hR = landscapeHeight(x + eps, z);
  const hD = landscapeHeight(x, z - eps);
  const hU = landscapeHeight(x, z + eps);
  const norm = new THREE.Vector3((hL - hR) / (2 * eps), 1.0, (hD - hU) / (2 * eps));
  return norm.normalize();
}

// Lush, voluminous 12-blade grass dome geometry designed for 100% overlapping, gapless coverage
function createBlenderGrassGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const heights: number[] = [];
  const indices: number[] = [];

  // 8 radial outer arching blades radiating 360 degrees
  const outerAngles = [
    0,
    Math.PI * 0.25,
    Math.PI * 0.5,
    Math.PI * 0.75,
    Math.PI,
    Math.PI * 1.25,
    Math.PI * 1.5,
    Math.PI * 1.75,
  ];

  outerAngles.forEach((angle, idx) => {
    const baseIdx = positions.length / 3;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const perpX = -sinA;
    const perpZ = cosA;

    const length = 1.7 + (idx % 2 === 0 ? 0.4 : 0.2);
    const lean = 0.52 + (idx % 3) * 0.1;
    const baseWidth = 0.62;

    const segs = 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const w = baseWidth * (1.0 - t * 0.72);
      const curve = Math.pow(t, 1.35) * lean * length;
      const curX = cosA * curve;
      const curZ = sinA * curve;
      const curY = t * length;

      // Left vertex
      positions.push(curX - perpX * (w * 0.5), curY, curZ - perpZ * (w * 0.5));
      uvs.push(0, t);
      heights.push(t);

      // Right vertex
      positions.push(curX + perpX * (w * 0.5), curY, curZ + perpZ * (w * 0.5));
      uvs.push(1, t);
      heights.push(t);
    }

    for (let s = 0; s < segs; s++) {
      const i0 = baseIdx + s * 2;
      const i1 = i0 + 1;
      const i2 = i0 + 2;
      const i3 = i0 + 3;
      indices.push(i0, i1, i2);
      indices.push(i1, i3, i2);
      // Double-sided
      indices.push(i0, i2, i1);
      indices.push(i1, i2, i3);
    }
  });

  // 4 inner upright blades filling the center core
  const innerAngles = [Math.PI * 0.125, Math.PI * 0.625, Math.PI * 1.125, Math.PI * 1.625];
  innerAngles.forEach((angle) => {
    const baseIdx = positions.length / 3;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const perpX = -sinA;
    const perpZ = cosA;

    const length = 1.45;
    const lean = 0.22;
    const baseWidth = 0.48;

    const segs = 2;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const w = baseWidth * (1.0 - t * 0.65);
      const curve = Math.pow(t, 1.2) * lean * length;
      const curX = cosA * curve;
      const curZ = sinA * curve;
      const curY = t * length;

      positions.push(curX - perpX * (w * 0.5), curY, curZ - perpZ * (w * 0.5));
      uvs.push(0, t);
      heights.push(t);

      positions.push(curX + perpX * (w * 0.5), curY, curZ + perpZ * (w * 0.5));
      uvs.push(1, t);
      heights.push(t);
    }

    for (let s = 0; s < segs; s++) {
      const i0 = baseIdx + s * 2;
      const i1 = i0 + 1;
      const i2 = i0 + 2;
      const i3 = i0 + 3;
      indices.push(i0, i1, i2);
      indices.push(i1, i3, i2);
      indices.push(i0, i2, i1);
      indices.push(i1, i2, i3);
    }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("aHeight", new THREE.Float32BufferAttribute(heights, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Procedural seamless vibrant emerald lawn grass texture for underlying terrain
function createGrassCanvasTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  // Bright vibrant lawn green base
  ctx.fillStyle = "#4ea62a";
  ctx.fillRect(0, 0, 512, 512);

  const imgData = ctx.getImageData(0, 0, 512, 512);
  const data = imgData.data;
  let s = 7719;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  for (let i = 0; i < data.length; i += 4) {
    const n = rnd() * 36 - 18;
    data[i] = Math.min(255, Math.max(0, 72 + n));            // R
    data[i + 1] = Math.min(255, Math.max(0, 168 + n * 1.25)); // G (vibrant emerald green)
    data[i + 2] = Math.min(255, Math.max(0, 46 + n));       // B
    data[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  // Micro-grass fibers
  ctx.strokeStyle = "rgba(132, 218, 65, 0.35)";
  ctx.lineWidth = 1.2;
  for (let j = 0; j < 1200; j++) {
    const x = rnd() * 512;
    const y = rnd() * 512;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 6, y - (4 + rnd() * 6));
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(40, 50);
  return texture;
}

function WindGrass() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { geometry, matrices, colors, count } = useMemo(() => {
    let seed = 9182;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const geometry = createBlenderGrassGeometry();
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    const upVec = new THREE.Vector3(0, 1, 0);

    const MAX_TUFTS = 48000;
    const matrices = new Float32Array(MAX_TUFTS * 16);
    const colors = new Float32Array(MAX_TUFTS * 3);
    const grassColors = ["#4ea62a", "#5cb836", "#68bf38", "#72cb3e", "#459c25", "#54ad32"];

    let placed = 0;

    // High-density grid sampling ensures 100% gapless overlapping coverage across the entire hill
    const sampleHillZone = (minX: number, maxX: number, minZ: number, maxZ: number, step: number) => {
      for (let x = minX; x <= maxX; x += step) {
        for (let z = minZ; z <= maxZ; z += step) {
          if (placed >= MAX_TUFTS) return;

          // Jitter grid coordinates
          const jx = x + (random() - 0.5) * step * 0.75;
          const jz = z + (random() - 0.5) * step * 0.75;

          // Strictly preserve facility floor & entry road
          if (isInsideFacility(jx, jz)) continue;

          const y = landscapeHeight(jx, jz);

          // Align grass tuft with hill surface normal
          const normal = getTerrainNormal(jx, jz);
          const align = upVec.clone().lerp(normal, 0.38).normalize();
          const quat = new THREE.Quaternion().setFromUnitVectors(upVec, align);
          const yaw = new THREE.Quaternion().setFromAxisAngle(align, random() * Math.PI * 2);
          quat.multiply(yaw);

          transform.position.set(jx, y + 0.02, jz);
          transform.quaternion.copy(quat);

          // Full, voluminous scale for zero gaps
          const scale = 1.05 + random() * 0.45;
          const height = 0.95 + random() * 1.15;
          transform.scale.set(scale, height, scale);
          transform.updateMatrix();

          matrices.set(transform.matrix.elements, placed * 16);
          color.set(grassColors[Math.floor(random() * grassColors.length)]);
          color.toArray(colors, placed * 3);
          placed++;
        }
      }
    };

    // 1. West Hill Range (Full dense flank outside wall)
    sampleHillZone(-175, -32.5, -295, 45, 1.45);
    // 2. East Hill Range (Full dense flank outside wall)
    sampleHillZone(32.5, 175, -295, 45, 1.45);
    // 3. Rear North Hill Range (Behind facility wall)
    sampleHillZone(-175, 175, -440, -252.5, 1.75);
    // 4. Front Entry Perimeter Hills (both sides of entry road)
    sampleHillZone(-160, -7.0, 15.2, 75, 1.45);
    sampleHillZone(7.0, 160, 15.2, 75, 1.45);

    return { geometry, matrices, colors, count: placed };
  }, []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute("instanceColor", new THREE.InstancedBufferAttribute(colors, 3));
  }, [colors, matrices]);

  useFrame(({ clock }) => {
    if (materialRef.current) materialRef.current.uniforms.uTime.value = clock.elapsedTime;
  });

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, count]} castShadow receiveShadow>
      <shaderMaterial
        ref={materialRef}
        vertexColors
        side={THREE.DoubleSide}
        uniforms={{
          uTime: { value: 0 },
          uBaseColor: { value: new THREE.Color("#388422") },
          uMidColor: { value: new THREE.Color("#5cb836") },
          uTipColor: { value: new THREE.Color("#82db44") },
        }}
        vertexShader={`
          attribute float aHeight;
          attribute vec3 instanceColor;
          uniform float uTime;
          varying vec3 vColor;
          varying float vHeight;

          void main() {
            vColor = instanceColor;
            vHeight = aHeight;

            vec3 pos = position;
            vec4 worldPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);

            // Natural multi-wave wind sway like Blender hair dynamics
            float w1 = sin(uTime * 1.8 + worldPos.x * 0.075 + worldPos.z * 0.045);
            float w2 = cos(uTime * 2.7 + worldPos.x * 0.12 - worldPos.z * 0.065) * 0.5;
            float gust = (w1 + w2) * 0.38;

            float sway = aHeight * aHeight * gust;
            pos.x += sway * 0.65;
            pos.z += sway * 0.45;

            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
          }
        `}
        fragmentShader={`
          uniform vec3 uBaseColor;
          uniform vec3 uMidColor;
          uniform vec3 uTipColor;
          varying vec3 vColor;
          varying float vHeight;

          void main() {
            // Bright, lush Blender root-to-tip gradient
            vec3 col = mix(uBaseColor, uMidColor, smoothstep(0.0, 0.45, vHeight));
            col = mix(col, uTipColor, smoothstep(0.45, 0.95, vHeight));
            col = mix(col, vColor, 0.2);

            // Sunlight backlight highlight on blade tips
            float tipGlow = smoothstep(0.7, 1.0, vHeight) * 0.25;
            col += vec3(0.12, 0.2, 0.05) * tipGlow;

            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </instancedMesh>
  );
}

export function NatureEnvironment() {
  const grassTexture = useMemo(() => createGrassCanvasTexture(), []);
  useEffect(() => () => grassTexture.dispose(), [grassTexture]);

  const terrain = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(600, 700, 160, 180);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -170);
    const vertices = geometry.attributes.position;
    const colors = new Float32Array(vertices.count * 3);
    const industrialGround = new THREE.Color("#64748b");
    const hillGround = new THREE.Color("#ffffff");
    const color = new THREE.Color();

    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i),
        z = vertices.getZ(i);
      const y = landscapeHeight(x, z);
      vertices.setY(i, y);

      if (isInsideFacility(x, z)) {
        color.copy(industrialGround);
      } else {
        color.copy(hillGround);
      }

      color.toArray(colors, i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, []);

  useEffect(() => () => terrain.dispose(), [terrain]);

  const forest = useMemo(() => {
    let seed = 8931;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const trunks: Instance[] = [],
      leaves: Instance[] = [],
      pines: Instance[] = [],
      rocks: Instance[] = [];

    const trunkColors = ["#543d2b", "#634834", "#73533b", "#4a3526"];
    const deciduousColors = ["#2f722a", "#3e8c33", "#4ea93c", "#377d2f", "#55b041"];
    const pineColors = ["#1a4d28", "#235e32", "#184524", "#286837"];

    // Generate 150 very big trees prominently visible all around the warehouse and entrance
    for (let i = 0; i < 150; i++) {
      let x = 0;
      let z = 0;

      if (i < 24) {
        // 1. Entrance Avenue Trees: majestic big trees lining both sides of the front gate road
        const side = i % 2 === 0 ? -1 : 1;
        x = side * (12.5 + (i % 6) * 3.8);
        z = 18.0 + Math.floor(i / 2) * 5.2; // spans z = 18 to z = 75
      } else if (i < 85) {
        // 2. West and East perimeter hill flanks (prominently framing warehouse sides)
        const side = i % 2 === 0 ? -1 : 1;
        x = side * (36.0 + random() * 115.0);
        z = 35.0 - random() * 320.0;
      } else {
        // 3. Northern rear mountain range
        x = (random() - 0.5) * 340.0;
        z = -258.0 - random() * 180.0;
      }

      if (isInsideFacility(x, z)) continue;

      const y = landscapeHeight(x, z);
      const pine = i % 3 === 0;

      // VERY BIG TREE SCALING (Heights 12 to 22 units, Canopy spans 8 to 15 units!)
      const scale = 1.75 + random() * 0.95; // 1.75x to 2.7x scale!
      const trunkColor = trunkColors[Math.floor(random() * trunkColors.length)];

      if (pine) {
        // Big mountain conifer tree
        const height = 11.0 * scale;
        const trunkRadius = 0.55 * scale;

        trunks.push({
          position: [x, y + height * 0.45, z],
          scale: [trunkRadius, height * 0.9, trunkRadius],
          rotation: [0, random() * Math.PI * 2, (random() - 0.5) * 0.05],
          color: trunkColor,
        });

        // 4 broad, wide conical foliage tiers
        const tierCount = 4;
        for (let tier = 0; tier < tierCount; tier++) {
          const radius = (5.2 - tier * 0.95) * scale;
          const tierHeight = (4.6 - tier * 0.4) * scale;
          const tierY = y + height * 0.35 + tier * 3.4 * scale;

          pines.push({
            position: [x, tierY, z],
            scale: [radius, tierHeight, radius],
            rotation: [0, random() * Math.PI * 2, 0],
            color: pineColors[(i + tier) % pineColors.length],
          });
        }
      } else {
        // Big full, lush round deciduous shade tree (like the reference image)
        const trunkHeight = 6.2 * scale;
        const trunkRadius = 0.65 * scale;

        trunks.push({
          position: [x, y + trunkHeight * 0.48, z],
          scale: [trunkRadius, trunkHeight * 0.95, trunkRadius],
          rotation: [0, random() * Math.PI * 2, (random() - 0.5) * 0.06],
          color: trunkColor,
        });

        // Massive central canopy dome
        const mainRadius = 4.8 * scale;
        leaves.push({
          position: [x, y + trunkHeight + 2.2 * scale, z],
          scale: [mainRadius, mainRadius * 0.95, mainRadius],
          rotation: [random() * 0.4, random() * Math.PI * 2, random() * 0.4],
          color: deciduousColors[i % deciduousColors.length],
        });

        // 4 large surrounding sub-canopy puffs for organic, bushy cloud silhouette
        const puffCount = 4;
        for (let p = 0; p < puffCount; p++) {
          const angle = (p * Math.PI * 2) / puffCount + random() * 0.5;
          const spread = 2.4 * scale;
          const puffRadius = (3.0 + random() * 0.6) * scale;
          leaves.push({
            position: [
              x + Math.cos(angle) * spread,
              y + trunkHeight + (1.6 + random() * 0.8) * scale,
              z + Math.sin(angle) * spread,
            ],
            scale: [puffRadius, puffRadius * 0.9, puffRadius],
            rotation: [random() * 0.5, angle, random() * 0.5],
            color: deciduousColors[(i + p + 1) % deciduousColors.length],
          });
        }
      }
    }

    // Natural landscape boulders
    for (let i = 0; i < 45; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (38 + random() * 125);
      const z = 30 - random() * 380;
      if (isInsideFacility(x, z)) continue;
      const size = 1.0 + random() * 2.4;
      rocks.push({
        position: [x, landscapeHeight(x, z) + size * 0.35, z],
        scale: [size * 1.4, size * 0.75, size * 1.1],
        rotation: [random(), random() * Math.PI, random() * 0.4],
        color: i % 2 ? "#8e9185" : "#717971",
      });
    }

    return { trunks, leaves, pines, rocks };
  }, []);

  return (
    <group>
      <mesh geometry={terrain} receiveShadow>
        <meshStandardMaterial map={grassTexture} vertexColors roughness={0.92} metalness={0} />
      </mesh>
      <WindGrass />
      <VegetationBatch items={forest.trunks} kind="trunk" />
      <VegetationBatch items={forest.leaves} kind="leaves" />
      <VegetationBatch items={forest.pines} kind="pine" />
      <VegetationBatch items={forest.rocks} kind="rock" />
    </group>
  );
}
