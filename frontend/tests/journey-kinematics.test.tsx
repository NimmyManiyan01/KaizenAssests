import { describe, it, expect } from "vitest";
import { computeJourneyKinematics } from "../src/components/journey/journeyKinematics";
import { journeyStore, setJourneyProgress } from "../src/components/journey/journeyStore";
import { getSharedQrTexture } from "../src/components/journey/models/PalletAndCargo";

describe("WMS 3D Journey Engine Verification", () => {
  it("should initialize journeyStore with default values and update correctly", () => {
    setJourneyProgress(0, 0);
    expect(journeyStore.scrollProgress).toBe(0);
    expect(journeyStore.overviewProgress).toBe(0);

    // rawProgress 0.56 -> scrollProgress = (0.56 - 0.12) / 0.88 = 0.5
    setJourneyProgress(0.56, 0.8);
    expect(journeyStore.scrollProgress).toBeCloseTo(0.5, 4);
    expect(journeyStore.overviewProgress).toBe(0.8);
    expect(journeyStore.supplierProgress).toBe(1.0);

    setJourneyProgress(0, 1);
  });

  it("should calculate valid kinematics for all stages without NaN", () => {
    const testPoints = [0, 0.05, 0.15, 0.25, 0.35, 0.5, 0.65, 0.8, 0.95, 1.0];
    for (const p of testPoints) {
      const kin = computeJourneyKinematics(p, 1, p);
      expect(kin.truck1Pos.every((val) => Number.isFinite(val))).toBe(true);
      expect(kin.truck1Rot.every((val) => Number.isFinite(val))).toBe(true);
      expect(kin.forkliftPos.every((val) => Number.isFinite(val))).toBe(true);
      expect(kin.forkliftRot.every((val) => Number.isFinite(val))).toBe(true);
      expect(kin.palletPos.every((val) => Number.isFinite(val))).toBe(true);
      expect(kin.truckExitPos.every((val) => Number.isFinite(val))).toBe(true);
      expect(Number.isFinite(kin.barrier1Open)).toBe(true);
      expect(Number.isFinite(kin.wheelRot)).toBe(true);
    }
  });

  it("should return the exact same shared singleton QR texture across invocations", () => {
    const tex1 = getSharedQrTexture();
    const tex2 = getSharedQrTexture();
    expect(tex1).toBe(tex2);
    if (tex1) {
      expect(tex1.image).toBeDefined();
    }
  });
});
