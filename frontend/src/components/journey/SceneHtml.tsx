import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFrame, useThree } from "@react-three/fiber";
import type { ThreeElements } from "@react-three/fiber";
import * as THREE from "three";

type Entry = { element: HTMLElement; children: ReactNode };
type Register = (id: string, entry: Entry | null) => void;
const PortalContext = createContext<Register | null>(null);

/** Labels are portals owned by the existing DOM root, never independently unmounted roots. */
export function SceneHtmlProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Map<string, Entry>>(() => new Map());
  const register = useCallback<Register>((id, entry) => {
    setEntries((previous) => {
      const next = new Map(previous);
      if (entry) next.set(id, entry);
      else next.delete(id);
      return next;
    });
  }, []);
  return (
    <PortalContext.Provider value={register}>
      {children}
      {[...entries].map(([id, entry]) => createPortal(entry.children, entry.element, id))}
    </PortalContext.Provider>
  );
}

type Props = ThreeElements["group"] & {
  children: ReactNode;
  center?: boolean;
  distanceFactor?: number;
  zIndexRange?: [number, number];
  fullscreen?: boolean;
  transform?: boolean;
  style?: CSSProperties;
};

export function SceneHtml({
  children,
  center = false,
  distanceFactor,
  zIndexRange = [30, 0],
  fullscreen = false,
  transform = false,
  style,
  ...groupProps
}: Props) {
  const register = useContext(PortalContext);
  const id = useId();
  const group = useRef<THREE.Group>(null);
  const element = useMemo(() => document.createElement("div"), []);
  const { gl } = useThree();
  const scratch = useMemo(
    () => ({ world: new THREE.Vector3(), ndc: new THREE.Vector3(), camera: new THREE.Vector3() }),
    [],
  );
  useEffect(() => {
    const parent = gl.domElement.parentElement;
    parent?.appendChild(element);
    return () => element.remove();
  }, [gl, element]);
  useEffect(() => {
    if (!register) throw new Error("SceneHtml must be inside SceneHtmlProvider");
    register(id, { element, children });
    return () => register(id, null);
  }, [register, id, element, children]);
  useFrame(({ camera, size }) => {
    const object = group.current;
    if (!object) return;
    let visible = true;
    object.traverseAncestors((parent) => {
      if (!parent.visible) visible = false;
    });
    object.getWorldPosition(scratch.world);
    scratch.ndc.copy(scratch.world).project(camera);
    visible &&= object.visible && scratch.ndc.z >= -1 && scratch.ndc.z <= 1;
    element.style.display = visible ? "block" : "none";
    if (!visible) return;
    const x = fullscreen ? 0 : (scratch.ndc.x * 0.5 + 0.5) * size.width;
    const y = fullscreen ? 0 : (-scratch.ndc.y * 0.5 + 0.5) * size.height;
    let scale = 1;
    if (distanceFactor && camera instanceof THREE.PerspectiveCamera) {
      camera.getWorldPosition(scratch.camera);
      scale =
        distanceFactor /
        (2 *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
          scratch.world.distanceTo(scratch.camera));
      if (transform) scale *= 4;
    }
    Object.assign(element.style, {
      position: "absolute",
      top: "0",
      left: "0",
      pointerEvents: "none",
      transformOrigin: "0 0",
      width: fullscreen ? `${size.width}px` : "max-content",
      height: fullscreen ? `${size.height}px` : "auto",
      zIndex: String(zIndexRange[0]),
      transform: `translate3d(${x}px,${y}px,0) scale(${scale}) ${center && !fullscreen ? "translate(-50%,-50%)" : ""}`,
      ...style,
    });
  });
  // The DOM inspector injects data-* metadata into custom components. It belongs
  // on the DOM label, not a Three object (R3F treats hyphens as property paths).
  const sceneProps = { ...groupProps };
  for (const key of Object.keys(sceneProps)) {
    if (key.startsWith("data-") || key.startsWith("aria-")) {
      delete (sceneProps as Record<string, unknown>)[key];
    }
  }
  return <group ref={group} {...sceneProps} />;
}
