import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { JOURNEY_STAGES, type JourneyStage } from "./data/journeyStages";
import { JourneyCanvas } from "./JourneyCanvas";
import { api } from "@/lib/api-client";
import { SceneHtmlProvider } from "./SceneHtml";
import { QualityContext } from "./quality";
import type { Quality } from "./quality";

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1);
  const [isFreeOrbit, setIsFreeOrbit] = useState(false);
  const [quality, setQuality] = useState<Quality>("BALANCED");
  const [qualitySelection, setQualitySelection] = useState<Quality | "AUTO">("AUTO");
  const [resumeGuided, setResumeGuided] = useState(false);
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
            liveTelemetry[item.label]
              ? { ...item, value: liveTelemetry[item.label] ?? item.value }
              : item,
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

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      overviewRef.current.val = 1;
      setOverviewProgress(1);
      return;
    }

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
    let lastReportedProgress = -1;
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

      if (Math.abs(displayedProgress.current - lastReportedProgress) > 0.0008 || settled) {
        lastReportedProgress = displayedProgress.current;
        setScrollProgress(displayedProgress.current);
      }

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
      setIsPlaying(false);
      setIsFreeOrbit(false);
      setResumeGuided(false);
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
    window.addEventListener("kaizenassests:replay-journey", replay);
    return () => window.removeEventListener("kaizenassests:replay-journey", replay);
  }, []);

  // Jump to specific stage
  const handleSelectStage = useCallback(
    (index: number) => {
      const trigger = scrollTriggerRef.current;
      if (!trigger) return;

      introTweenRef.current?.kill();
      overviewRef.current.val = 1;
      setOverviewProgress(1);

      const journeyFraction = index === 0 ? 0 : 0.12 + (0.88 * index) / (stages.length - 1);
      const targetFraction =
        OVERVIEW_SCROLL_FRACTION + journeyFraction * (1 - OVERVIEW_SCROLL_FRACTION);
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

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  const handleChangeSpeed = useCallback((speed: number) => {
    setPlaySpeed(speed);
  }, []);

  const handleToggleFreeOrbit = useCallback(() => {
    setIsPlaying(false);
    setResumeGuided(true);
    setIsFreeOrbit((prev) => !prev);
  }, []);

  const handleRestart = useCallback(() => {
    handleSelectStage(0);
  }, [handleSelectStage]);

  return (
    <QualityContext.Provider value={quality}>
      <SceneHtmlProvider>
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
              selectedAsn={asnRecords.find(
                (asn) => String(asn.id || asn.asn_number) === selectedAsnId,
              )}
              mouseOffset={mouseOffset}
              onSelectStage={handleSelectStage}
              isFreeOrbit={isFreeOrbit}
              resumeGuided={resumeGuided}
              automaticQuality={qualitySelection === "AUTO"}
              onQualityChange={setQuality}
            />
          ) : (
            <div className="absolute inset-0 bg-[#e7e9e5] flex items-center justify-center">
              <div className="size-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-3 bottom-5 z-40 flex flex-wrap items-center justify-center gap-2 text-xs sm:inset-x-6">
            <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-xl border border-slate-500/30 bg-slate-950/90 p-2 text-white shadow-lg">
              <button
                type="button"
                aria-pressed={isFreeOrbit}
                className="rounded-lg px-3 py-2 focus-visible:outline-cyan-400"
                onClick={handleToggleFreeOrbit}
              >
                {isFreeOrbit ? "Return to Guided" : "Explore campus"}
              </button>
              <button
                type="button"
                className="rounded-lg px-3 py-2"
                onClick={() => {
                  window.dispatchEvent(new Event("kaizenassests:replay-journey"));
                  window.scrollTo({
                    top: 0,
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                      ? "instant"
                      : "smooth",
                  });
                }}
              >
                Replay
              </button>
              <label className="flex items-center gap-2 px-2">
                Quality
                <select
                  aria-label="Rendering quality"
                  value={qualitySelection}
                  className="rounded bg-slate-800 p-2"
                  onChange={(event) => {
                    const value = event.target.value as Quality | "AUTO";
                    setQualitySelection(value);
                    if (value !== "AUTO") setQuality(value);
                  }}
                >
                  <option value="AUTO">Auto ({quality.toLowerCase()})</option>
                  <option value="HIGH">High</option>
                  <option value="BALANCED">Balanced</option>
                  <option value="PERFORMANCE">Performance</option>
                </select>
              </label>
            </div>
            <span className="sr-only" aria-live="polite">
              {isFreeOrbit
                ? "Explore mode: drag to orbit, pinch or scroll to zoom."
                : "Guided mode: scroll to follow the journey."}
            </span>
          </div>
          <div
            hidden={scrollProgress < 0.12}
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
      </SceneHtmlProvider>
    </QualityContext.Provider>
=======
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

      <div
        hidden={scrollProgress < 0.12}
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
>>>>>>> origin/main
  );
}
