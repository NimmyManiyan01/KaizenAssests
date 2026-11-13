import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { JOURNEY_STAGES, type JourneyStage } from "./data/journeyStages";
import { JourneyCanvas } from "./JourneyCanvas";
import { api } from "@/lib/api-client";
import { isAuthenticated } from "@/lib/auth-utils";
import { scrollLandingTo } from "@/lib/useLenis";
import { journeyStore, setJourneyProgress } from "./journeyStore";

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
  const [taglineIndex, setTaglineIndex] = useState(0);
  const [showPutawayHud, setShowPutawayHud] = useState(false);
  const [putawayStored, setPutawayStored] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1);
  const [isFreeOrbit, setIsFreeOrbit] = useState(false);

  const activeIndexRef = useRef(0);
  const taglineIndexRef = useRef(0);
  const showPutawayHudRef = useRef(false);
  const putawayStoredRef = useRef(false);

  const mouseOffset = useRef({ x: 0, y: 0 }).current;
  const targetProgress = useRef(0);

  const introTweenRef = useRef<gsap.core.Tween | null>(null);
  const overviewRef = useRef({ val: 0 });
  const [liveSnapshot, setLiveSnapshot] = useState<Record<string, number | string>>({});
  const [asnRecords, setAsnRecords] = useState<any[]>([]);
  const [selectedAsnId, setSelectedAsnId] = useState("");

  useEffect(() => {
    if (!isAuthenticated()) return;
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
    if (!isAuthenticated()) return;
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
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      (window as any).requestIdleCallback(() => void loadSnapshot());
    } else {
      setTimeout(() => void loadSnapshot(), 1200);
    }
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

  useEffect(() => {
    setMounted(true);
  }, []);

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

  // Smooth continuous Play animation loop
  useEffect(() => {
    if (!isPlaying || !mounted) return;

    introTweenRef.current?.kill();
    overviewRef.current.val = 1;
    setJourneyProgress(targetProgress.current, 1);

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

      // Synchronize document scroll position without abrupt behavior
      const trigger = scrollTriggerRef.current;
      if (trigger) {
        const targetFraction =
          OVERVIEW_SCROLL_FRACTION + nextProgress * (1 - OVERVIEW_SCROLL_FRACTION);
        const targetScroll = trigger.start + targetFraction * (trigger.end - trigger.start);
        scrollLandingTo(targetScroll, true);
      }

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
          targetProgress.current = rawProgress;

          if (rawProgress > 0.002 && introTweenRef.current?.isActive()) {
            introTweenRef.current.kill();
          }

          const op =
            rawProgress <= OVERVIEW_SCROLL_FRACTION
              ? rawProgress / OVERVIEW_SCROLL_FRACTION
              : 1;
          overviewRef.current.val = op;

          // Update shared GPU animation store without triggering React state cascade
          setJourneyProgress(rawProgress, op);

          // Update discrete active index ONLY when crossing stage boundaries
          const nextIndex = Math.min(
            stages.length - 1,
            Math.max(0, Math.round(journeyStore.scrollProgress * (stages.length - 1))),
          );
          if (nextIndex !== activeIndexRef.current) {
            activeIndexRef.current = nextIndex;
            setActiveIndex(nextIndex);
          }

          // Update discrete tagline index ONLY when passing tagline thresholds
          if (journeyStore.taglineIndex !== taglineIndexRef.current) {
            taglineIndexRef.current = journeyStore.taglineIndex;
            setTaglineIndex(journeyStore.taglineIndex);
          }

          // Update discrete Putaway HUD visibility (Phase 4)
          const sp = journeyStore.scrollProgress;
          const showHud = sp >= 0.365 && sp <= 0.44;
          if (showHud !== showPutawayHudRef.current) {
            showPutawayHudRef.current = showHud;
            setShowPutawayHud(showHud);
          }
          const stored = sp >= 0.39;
          if (stored !== putawayStoredRef.current) {
            putawayStoredRef.current = stored;
            setPutawayStored(stored);
          }
        },
      });

      scrollTriggerRef.current = trigger;
    });

    return () => {
      ctx.revert();
      scrollTriggerRef.current = null;
      setJourneyProgress(0, 0);
    };
  }, [mounted, stages.length]);

  useEffect(() => {
    const replay = () => {
      introTweenRef.current?.kill();
      // Let ScrollTrigger publish the animated return, rather than teleporting
      // the camera to frame zero while the document is still at the bottom.
      // The landing page owns the single Lenis scrollTo call for replay.
    };
    window.addEventListener("warehub:replay-journey", replay);
    window.addEventListener("kaizenassests:replay-journey", replay);
    return () => {
      window.removeEventListener("warehub:replay-journey", replay);
      window.removeEventListener("kaizenassests:replay-journey", replay);
    };
  }, []);

  // Jump to specific stage
  const handleSelectStage = useCallback(
    (index: number) => {
      const trigger = scrollTriggerRef.current;
      if (!trigger) return;

      introTweenRef.current?.kill();
      overviewRef.current.val = 1;
      setJourneyProgress(journeyStore.progress, 1);

      const targetFraction =
        OVERVIEW_SCROLL_FRACTION + (index / (stages.length - 1)) * (1 - OVERVIEW_SCROLL_FRACTION);
      const targetScroll = trigger.start + targetFraction * (trigger.end - trigger.start);

      scrollLandingTo(targetScroll);
    },
    [stages.length],
  );

  const handleToggleTopView = useCallback(() => {
    introTweenRef.current?.kill();
    const targetVal = overviewRef.current.val < 0.5 ? 1 : 0;

    if (targetVal === 0 && window.scrollY > 80) {
      scrollLandingTo(0);
    }

    introTweenRef.current = gsap.to(overviewRef.current, {
      val: targetVal,
      duration: 2.2,
      ease: "power2.inOut",
      onUpdate: () => {
        setJourneyProgress(journeyStore.progress, overviewRef.current.val);
      },
    });
  }, []);

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
      className="relative w-full h-screen overflow-hidden bg-[#e7e9e5] select-none"
    >
      {/* 3D WebGL Canvas Layer (Single Persistent World) */}
      {mounted ? (
        <JourneyCanvas
          stages={liveStages}
          activeIndex={activeIndex}
          selectedAsn={asnRecords.find((asn) => String(asn.id || asn.asn_number) === selectedAsnId)}
          mouseOffset={mouseOffset}
          onSelectStage={handleSelectStage}
          isFreeOrbit={isFreeOrbit}
        />
      ) : (
        <div className="absolute inset-0 bg-[#e7e9e5] flex items-center justify-center">
          <div className="size-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
        </div>
      )}

      {/* Putaway Verification Tag (Moved from 3D Drei Html to Native 2D DOM HUD for 60fps performance) */}
      {showPutawayHud && (
        <div className="pointer-events-none absolute bottom-6 left-4 max-w-[calc(100vw-2rem)] bg-slate-950/90 border border-emerald-500/70 px-4 py-3 rounded shadow-xl shadow-emerald-500/20 backdrop-blur z-30 text-left sm:bottom-8 sm:left-8 animate-in fade-in duration-300">
          <div className="flex items-center justify-center gap-1.5 font-mono text-[10px] text-emerald-400 font-bold tracking-wider">
            <span
              className={`w-2 h-2 rounded-full ${putawayStored ? "bg-emerald-400" : "bg-cyan-400 animate-pulse"}`}
            />
            {putawayStored
              ? "BIN AISLE-04-B1 : STORED ✓"
              : "PUTAWAY : SLOTTING BIN..."}
          </div>
          <div className="text-[9px] font-mono text-slate-400 mt-0.5">
            PLT-77291 • RACK-B-08 • TIER 01
            {putawayStored && (
              <div className="mt-1 text-emerald-300">INVENTORY UPDATED / AVAILABLE</div>
            )}
          </div>
        </div>
      )}

      {/* Cinematic Tagline Overlay */}
      <div

        className="pointer-events-none absolute inset-x-0 top-[17%] z-30 flex -translate-y-1/2 justify-center px-6 text-center"
      >
        <p
          key={taglineIndex}
          className="max-w-xl animate-in fade-in duration-700 text-xl font-semibold tracking-tight text-white drop-shadow-[0_3px_18px_rgba(0,0,0,0.9)] sm:text-3xl lg:text-4xl"
        >
          {CINEMATIC_TAGLINES[taglineIndex]}
        </p>
      </div>
    </section>
  );
}
