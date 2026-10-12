import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { JOURNEY_STAGES, type JourneyStage } from "./data/journeyStages";
import { JourneyCanvas } from "./JourneyCanvas";
import { api } from "@/lib/api-client";

gsap.registerPlugin(ScrollTrigger);

const OVERVIEW_SCROLL_FRACTION = 0.08;
const CINEMATIC_TAGLINES = [
  "Every Journey Begins at the Gate.",
  "Every Material Counts.",
  "The Right Material. The Right Place.",
  "Complete Visibility. Total Control.",
  "Turning Materials into Possibilities.",
  "Quality Without Compromise.",
  "Ready for the World.",
  "Every Delivery, Seamlessly Dispatched.",
] as const;

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
  const mouseOffset = useRef({ x: 0, y: 0 }).current;
  const targetProgress = useRef(0);
  const displayedProgress = useRef(0);
  const wakeScrollRef = useRef<(() => void) | null>(null);

  const introTweenRef = useRef<gsap.core.Tween | null>(null);
  const overviewRef = useRef({ val: 0 });
  const [liveSnapshot, setLiveSnapshot] = useState<Record<string, number | string>>({});
  const [asnRecords, setAsnRecords] = useState<any[]>([]);
  const [selectedAsnId, setSelectedAsnId] = useState("");

  useEffect(() => {
    let cancelled = false;
    const loadAsnJourney = async () => {
      const [asnResult, gateResult] = await Promise.allSettled([
        api.getAsns(),
        api.getGateEntries(),
      ]);
      if (cancelled) return;
      const asns =
        asnResult.status === "fulfilled" && Array.isArray(asnResult.value) ? asnResult.value : [];
      const gates =
        gateResult.status === "fulfilled" && Array.isArray(gateResult.value)
          ? gateResult.value
          : [];
      const enriched = asns.map((asn: any) => {
        const linked = gates
          .filter(
            (gate: any) =>
              String(gate.asn_id || "") === String(asn.id || "") ||
              String(gate.asn_number || "").toLowerCase() ===
                String(asn.asn_number || "").toLowerCase(),
          )
          .sort((a: any, b: any) =>
            String(b.created_at || "").localeCompare(String(a.created_at || "")),
          )[0];
        return { ...asn, linked_gate_entry: linked || null };
      });
      setAsnRecords(enriched);
      setSelectedAsnId((current) =>
        current && enriched.some((asn: any) => String(asn.id || asn.asn_number) === current)
          ? current
          : String(enriched[0]?.id || enriched[0]?.asn_number || ""),
      );
    };
    void loadAsnJourney();
    const timer = window.setInterval(() => void loadAsnJourney(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadSnapshot = async () => {
      const [gates, dashboard, inventory, assembly, dispatch, exits] = await Promise.allSettled([
        api.getGateEntries(),
        api.getDashboardStats(),
        api.getWarehouseDashboardMetrics(),
        api.getAssemblyDashboard(),
        api.getDispatchKpis(),
        api.getGateExitQueue(),
      ]);
      if (cancelled) return;

      const value = (result: PromiseSettledResult<any>, ...keys: string[]) => {
        if (result.status !== "fulfilled") return "—";
        let current = result.value;
        for (const key of keys) current = current?.[key];
        return typeof current === "number" || typeof current === "string" ? current : "—";
      };
      const count = (result: PromiseSettledResult<any>) => {
        if (result.status !== "fulfilled") return "—";
        const data = result.value;
        if (Array.isArray(data)) return data.length;
        if (Array.isArray(data?.items)) return data.items.length;
        return "—";
      };

      setLiveSnapshot({
        gateEntries: count(gates),
        grnRecords: value(dashboard, "stats", "totalGrns"),
        inventoryAvailable: value(inventory, "available_quantity"),
        inventoryReserved: value(inventory, "reserved_quantity"),
        assemblyOrders: value(assembly, "kpis", "total_orders"),
        assemblyYield: value(assembly, "kpis", "first_pass_yield"),
        dispatches: value(dispatch, "total"),
        dispatchReady: value(dispatch, "ready"),
        gateExits: count(exits),
      });
    };
    void loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, []);

  const liveStages = useMemo(
    () =>
      stages.map((stage) => {
        const telemetryByStage: Record<string, Record<string, string>> = {
          "gate-entry": {
            "GATE ENTRIES": String(liveSnapshot.gateEntries ?? "—"),
          },
          grn: {
            "GRN RECORDS": String(liveSnapshot.grnRecords ?? "—"),
          },
          inventory: {
            AVAILABLE: String(liveSnapshot.inventoryAvailable ?? "—"),
            RESERVED: String(liveSnapshot.inventoryReserved ?? "—"),
          },
          assembly: {
            "ACTIVE ORDERS": String(liveSnapshot.assemblyOrders ?? "—"),
            "FIRST-PASS YIELD": String(liveSnapshot.assemblyYield ?? "—"),
          },
          dispatch: {
            DISPATCHES: String(liveSnapshot.dispatches ?? "—"),
            READY: String(liveSnapshot.dispatchReady ?? "—"),
          },
          "gate-exit": {
            "EXIT QUEUE": String(liveSnapshot.gateExits ?? "—"),
          },
        };
        const liveTelemetry = telemetryByStage[stage.id];
        if (!liveTelemetry) return stage;
        return {
          ...stage,
          telemetry: stage.telemetry.map((item) =>
            liveTelemetry[item.label] ? { ...item, value: liveTelemetry[item.label] } : item,
          ),
        };
      }),
    [stages, liveSnapshot],
  );

  const taglineIndex = useMemo(() => {
    const p = Math.max(0, (scrollProgress - 0.12) / 0.88);
    if (p < 0.12) return 0;
    if (p < 0.25) return 1;
    if (p < 0.38) return 2;
    if (p < 0.55) return 3;
    if (p < 0.68) return 4;
    if (p < 0.78) return 5;
    if (p < 0.9) return 6;
    return 7;
  }, [scrollProgress]);

  // Mouse Parallax Lerp

  useEffect(() => {
    setMounted(true);
  }, []);

  // Automatic cinematic intro on page load:
  // Starts with the front warehouse top view (val = 0), holds briefly, then smoothly swoops down to Gate Entry (val = 1).
  useEffect(() => {
    if (!mounted) return;

    introTweenRef.current = gsap.to(overviewRef.current, {
      val: 1,
      duration: 2.4,
      delay: 1.0,
      ease: "power2.inOut",
      onUpdate: () => {
        setOverviewProgress(overviewRef.current.val);
      },
    });

    return () => {
      introTweenRef.current?.kill();
    };
  }, [mounted]);

  // Read pointer targets in the camera without rerendering the entire scene.
  useEffect(() => {
    if (!mounted) return;
    const move = (event: MouseEvent) => {
      mouseOffset.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouseOffset.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("mousemove", move, { passive: true });
    return () => window.removeEventListener("mousemove", move);
  }, [mounted, mouseOffset]);

  // Native-refresh scroll damping. No React frame updates while scroll is idle.
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
        : current + (target - current) * (1 - Math.exp(-20 * delta));
      const settled = Math.abs(target - next) < 0.00001;
      displayedProgress.current = settled ? target : next;
      setScrollProgress(displayedProgress.current);
      const nextIndex = Math.min(
        stages.length - 1,
        Math.max(0, Math.round(displayedProgress.current * (stages.length - 1))),
      );
      setActiveIndex((currentIndex) => (currentIndex === nextIndex ? currentIndex : nextIndex));
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

          // If user starts scrolling, kill the intro animation so scroll takes control
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

  useEffect(() => {
    const replay = () => {
      introTweenRef.current?.kill();
      targetProgress.current = 0;
      displayedProgress.current = 0;
      overviewRef.current.val = 0;
      setScrollProgress(0);
      setOverviewProgress(0);
      setActiveIndex(0);
      wakeScrollRef.current?.();
      requestAnimationFrame(() => {
        ScrollTrigger.refresh();
      });
    };
    window.addEventListener("kaizenx:replay-journey", replay);
    return () => window.removeEventListener("kaizenx:replay-journey", replay);
  }, []);

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

  // Toggle between front warehouse top view and gate entry
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

  return (
    <section
      id="wms-flow-journey"
      ref={pinRef}
      className="relative w-full h-screen overflow-hidden bg-[#e7e9e5] select-none"
    >
      {/* 3D WebGL Canvas Layer (Single Persistent World) */}
      {mounted ? (
        <JourneyCanvas
          stages={liveStages}
          activeIndex={activeIndex}
          scrollProgress={scrollProgress}
          overviewProgress={overviewProgress}
          selectedAsn={asnRecords.find((asn) => String(asn.id || asn.asn_number) === selectedAsnId)}
          mouseOffset={mouseOffset}
          onSelectStage={handleSelectStage}
        />
      ) : (
        <div className="absolute inset-0 bg-[#e7e9e5] flex items-center justify-center">
          <div className="size-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
        </div>
      )}

      {/* Cinematic tagline overlay replaces the operational landing HUD. */}
      {false ? (
        <div className="pointer-events-none absolute inset-x-0 top-24 sm:top-28 text-center transition-all duration-500">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-950/70 border border-cyan-500/40 backdrop-blur-md mb-2.5 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
            <span className="size-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-cyan-300 uppercase">
              FACILITY FRONT • FULL PERSPECTIVE
            </span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight drop-shadow-[0_2px_16px_rgba(0,0,0,0.8)]">
            Logistics Terminal & Inbound Gate
          </h2>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-300 max-w-md mx-auto drop-shadow font-medium px-4">
            Full view of warehouse front facade, security gate, and inbound approach
          </p>
        </div>
      ) : null}

      <div
        hidden={scrollProgress < 0.12}
        className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 justify-center px-6 text-center"
      >
        <p
          key={taglineIndex}
          className="max-w-3xl animate-in fade-in duration-700 text-3xl font-semibold tracking-tight text-white drop-shadow-[0_3px_18px_rgba(0,0,0,0.9)] sm:text-5xl lg:text-6xl"
        >
          {CINEMATIC_TAGLINES[taglineIndex]}
        </p>
      </div>
    </section>
  );
}
