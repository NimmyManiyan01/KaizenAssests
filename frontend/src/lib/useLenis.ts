import { useEffect, useRef } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "lenis/dist/lenis.css";

let activeLenis: Lenis | null = null;
export function scrollLandingTo(top: number, immediate = false) {
  if (activeLenis) activeLenis.scrollTo(top, { immediate, duration: 1.1, lerp: 0 });
  else window.scrollTo({ top, behavior: "instant" });
}

export function useLenis(enabled = true) {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    gsap.registerPlugin(ScrollTrigger);

    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let dispose = () => {};
    const setup = () => {
      dispose();
      dispose = () => {};
      if (preference.matches) return;
      const lenis = new Lenis({ autoRaf: false, lerp: 0.1, smoothWheel: true,
        syncTouch: false, wheelMultiplier: 1, anchors: true });
      lenisRef.current = activeLenis = lenis;
      const tick = (seconds: number) => lenis.raf(seconds * 1000);
      const resize = () => lenis.resize();
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(tick, false, true);
      gsap.ticker.lagSmoothing(0);
      ScrollTrigger.addEventListener("refresh", resize);
      dispose = () => {
        ScrollTrigger.removeEventListener("refresh", resize);
        gsap.ticker.remove(tick);
        lenis.off("scroll", ScrollTrigger.update);
        lenis.destroy();
        lenisRef.current = null;
        if (activeLenis === lenis) activeLenis = null;
        gsap.ticker.lagSmoothing(500, 33);
      };
    };
    setup();
    preference.addEventListener("change", setup);
    return () => {
      preference.removeEventListener("change", setup);
      dispose();
    };
  }, [enabled]);

  return lenisRef;
}
