// Shared reactive store for 60fps/120fps continuous animation
// Decouples Three.js rendering loops from React component reconciliation.

export interface JourneyStoreState {
  progress: number; // 0 to 1 continuous journey progress
  overviewProgress: number; // 0 to 1 cinematic intro transition
  scrollProgress: number; // normalized (progress - 0.12) / 0.88 clamped to [0, 1]
  supplierProgress: number; // normalized progress / 0.12 clamped to [0, 1]
  activeIndex: number; // Discrete stage index 0..7
  taglineIndex: number; // Discrete cinematic tagline index 0..7
}

export const journeyStore: JourneyStoreState = {
  progress: 0,
  overviewProgress: 0,
  scrollProgress: 0,
  supplierProgress: 0,
  activeIndex: 0,
  taglineIndex: 0,
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeJourneyStore(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyJourneyStore() {
  for (const listener of listeners) {
    listener();
  }
}

export function setJourneyProgress(rawProgress: number, overview = 1) {
  journeyStore.progress = rawProgress;
  journeyStore.overviewProgress = overview;
  journeyStore.supplierProgress = Math.min(1, Math.max(0, rawProgress / 0.12));
  journeyStore.scrollProgress = Math.min(1, Math.max(0, (rawProgress - 0.12) / 0.88));

  // Compute discrete indices
  const p = journeyStore.scrollProgress;
  let tIndex = 7;
  if (p < 0.12) tIndex = 0;
  else if (p < 0.25) tIndex = 1;
  else if (p < 0.38) tIndex = 2;
  else if (p < 0.55) tIndex = 3;
  else if (p < 0.68) tIndex = 4;
  else if (p < 0.78) tIndex = 5;
  else if (p < 0.9) tIndex = 6;

  journeyStore.taglineIndex = tIndex;
}

