import { useEffect, useRef, useState, useCallback } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { JOURNEY_STAGES, type JourneyStage } from "./data/journeyStages";
import { JourneyCanvas } from "./JourneyCanvas";
import { DetailReader } from "./DetailReader";
import { JourneyHUD } from "./JourneyHUD";

gsap.registerPlugin(ScrollTrigger);

const OVERVIEW_SCROLL_FRACTION = 0.08;

interface WarehouseJourneyProps {
  stages?: JourneyStage[];
}

export function WarehouseJourney({ stages = JOURNEY_STAGES }: WarehouseJourneyProps) {
  const pinRef = useRef<HTMLDivElement>(null);
  const scrollTriggerRef = useRef<ScrollTrigger | null>(null);

  const [mounted, setMounted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [overviewProgress, setOverviewProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1);
  const [isFreeOrbit, setIsFreeOrbit] = useState(false);

  const mouseOffset = useRef({ x: 0, y: 0 }).current;
  const targetProgress = useRef(0);
  const displayedProgress = useRef(0);
  const wakeScrollRef = useRef<(() => void) | null>(null);

  const introTweenRef = useRef<gsap.core.Tween | null>(null);
  const overviewRef = useRef({ val: 0 });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Automatic cinematic intro on page load
  useEffect(() => {
    if (!mounted) return;

    introTweenRef.current = gsap.to(overviewRef.current, {
      val: 1,
      duration: 2.4,
      delay: 0.8,
      ease: "power2.inOut",
      onUpdate: () => {
        setOverviewProgress(overviewRef.current.val);
      },
    });

    return () => {
      introTweenRef.current?.kill();
    };
  }, [mounted]);

  // Read pointer targets in the camera without rerendering the entire scene
  useEffect(() => {
    if (!mounted) return;
    const move = (event: MouseEvent) => {
      mouseOffset.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouseOffset.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("mousemove", move, { passive: true });
    return () => window.removeEventListener("mousemove", move);
  }, [mounted, mouseOffset]);

  // Native-refresh scroll damping
  useEffect(() => {
    if (!mounted) return;
    let frame: number | null = null;
    let previousTime = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = (time: number) => {
      const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 1 / 120;
      previousTime = time;
      const target = targetProgress.current;
      const current = displayedProgress.current;
      const next = reducedMotion
        ? target
        : current + (target - current) * (1 - Math.exp(-16 * delta));
      const settled = Math.abs(target - next) < 0.00001;
      displayedProgress.current = settled ? target : next;
      setScrollProgress(displayedProgress.current);
      setActiveIndex(
        Math.min(
          stages.length - 1,
          Math.max(0, Math.round(displayedProgress.current * (stages.length - 1))),
        ),
      );
      frame = settled ? null : requestAnimationFrame(tick);
    };
    wakeScrollRef.current = () => {
      if (frame === null) {
        previousTime = 0;
        frame = requestAnimationFrame(tick);
      }
    };
    wakeScrollRef.current();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      wakeScrollRef.current = null;
    };
  }, [mounted, stages.length]);

  // Smooth continuous Play animation loop
  useEffect(() => {
    if (!isPlaying || !mounted) return;

    introTweenRef.current?.kill();
    overviewRef.current.val = 1;
    setOverviewProgress(1);

    let frame: number | null = null;
    let lastTime = performance.now();

    const playTick = (now: number) => {
      const delta = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      // Complete 16-stage tour in ~36 seconds at 1x speed
      const advanceRate = (1 / 36) * playSpeed;
      let nextProgress = targetProgress.current + advanceRate * delta;

      if (nextProgress >= 1.0) {
        nextProgress = 0.0;
      }

      targetProgress.current = nextProgress;

      // Synchronize document scroll position without abrupt behavior:"smooth"
      const trigger = scrollTriggerRef.current;
      if (trigger) {
        const targetFraction =
          OVERVIEW_SCROLL_FRACTION + nextProgress * (1 - OVERVIEW_SCROLL_FRACTION);
        const targetScroll = trigger.start + targetFraction * (trigger.end - trigger.start);
        window.scrollTo(0, targetScroll);
      }

      wakeScrollRef.current?.();
      frame = requestAnimationFrame(playTick);
    };

    frame = requestAnimationFrame(playTick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [isPlaying, playSpeed, mounted]);

  // GSAP ScrollTrigger pinning and scrub tracking
  useEffect(() => {
    if (!mounted || !pinRef.current) return;

    const ctx = gsap.context(() => {
      const trigger = ScrollTrigger.create({
        trigger: pinRef.current,
        start: "top top",
        end: "+=7800",
        pin: true,
        anticipatePin: 1,
        onUpdate: (self) => {
          const rawProgress = self.progress;

          if (rawProgress > 0.002 && introTweenRef.current?.isActive()) {
            introTweenRef.current.kill();
          }

          if (rawProgress <= OVERVIEW_SCROLL_FRACTION) {
            const op = rawProgress / OVERVIEW_SCROLL_FRACTION;
            overviewRef.current.val = op;
            setOverviewProgress(op);
          } else {
            overviewRef.current.val = 1;
            setOverviewProgress(1);
          }

          const p = Math.max(
            0,
            (rawProgress - OVERVIEW_SCROLL_FRACTION) / (1 - OVERVIEW_SCROLL_FRACTION),
          );
          targetProgress.current = p;
          wakeScrollRef.current?.();
        },
      });

      scrollTriggerRef.current = trigger;
    });

    return () => {
      ctx.revert();
    };
  }, [mounted, stages.length]);

  // Jump to specific stage
  const handleSelectStage = useCallback(
    (index: number) => {
      const trigger = scrollTriggerRef.current;
      if (!trigger) return;

      introTweenRef.current?.kill();
      overviewRef.current.val = 1;
      setOverviewProgress(1);

      const targetFraction =
        OVERVIEW_SCROLL_FRACTION + (index / (stages.length - 1)) * (1 - OVERVIEW_SCROLL_FRACTION);
      const targetScroll = trigger.start + targetFraction * (trigger.end - trigger.start);

      window.scrollTo({
        top: targetScroll,
        behavior: "smooth",
      });
    },
    [stages.length],
  );

  const handleToggleTopView = useCallback(() => {
    introTweenRef.current?.kill();
    const targetVal = overviewProgress < 0.5 ? 1 : 0;

    if (targetVal === 0 && window.scrollY > 80) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    introTweenRef.current = gsap.to(overviewRef.current, {
      val: targetVal,
      duration: 2.2,
      ease: "power2.inOut",
      onUpdate: () => {
        setOverviewProgress(overviewRef.current.val);
      },
    });
  }, [overviewProgress]);

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  const handleChangeSpeed = useCallback((speed: number) => {
    setPlaySpeed(speed);
  }, []);

  const handleToggleFreeOrbit = useCallback(() => {
    setIsFreeOrbit((prev) => !prev);
  }, []);

  const handleRestart = useCallback(() => {
    handleSelectStage(0);
  }, [handleSelectStage]);

  return (
    <section
      id="wms-flow-journey"
      ref={pinRef}
      className="relative w-full h-screen overflow-hidden bg-slate-950 select-none"
    >
      {/* 3D WebGL Canvas Layer (Single Persistent World) */}
      {mounted ? (
        <JourneyCanvas
          stages={stages}
          activeIndex={activeIndex}
          scrollProgress={scrollProgress}
          overviewProgress={overviewProgress}
          mouseOffset={mouseOffset}
          onSelectStage={handleSelectStage}
          isFreeOrbit={isFreeOrbit}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-950 flex items-center justify-center">
          <div className="size-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
        </div>
      )}
    </section>
  );
}
