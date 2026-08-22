import { describe, it, expect } from "vitest";
import {
  calculateFlowGph,
  runtimeMinutes,
  constrainRuntime,
  IrrigationMethod,
  RuntimeResult,
} from "@/domain/runtime-converter";

describe("runtime-converter", () => {
  describe("calculateFlowGph", () => {
    describe("drip irrigation", () => {
      it("calculates flow rate: emitter_count × emitter_gph", () => {
        // 100 emitters × 0.5 gph each = 50 gph
        const result = calculateFlowGph("drip", {
          emitter_count: 100,
          emitter_gph: 0.5,
        });
        expect(result.gph).toBe(50);
      });

      it("handles zero emitters", () => {
        const result = calculateFlowGph("drip", { emitter_count: 0, emitter_gph: 0.5 });
        expect(result.gph).toBe(0);
      });

      it("uses 0 as default when specs are missing", () => {
        const result = calculateFlowGph("drip", {});
        expect(result.gph).toBe(0);
      });
    });

    describe("spray irrigation", () => {
      it("calculates flow rate: head_count × head_gpm × 60", () => {
        // 20 heads × 0.5 gpm × 60 = 600 gph
        const result = calculateFlowGph("spray", {
          head_count: 20,
          head_gpm: 0.5,
        });
        expect(result.gph).toBe(600);
      });

      it("converts gpm to gph correctly", () => {
        // 1 gpm = 60 gph
        const result = calculateFlowGph("spray", { head_count: 1, head_gpm: 1 });
        expect(result.gph).toBe(60);
      });

      it("handles zero heads", () => {
        const result = calculateFlowGph("spray", { head_count: 0, head_gpm: 0.5 });
        expect(result.gph).toBe(0);
      });
    });

    describe("soaker irrigation", () => {
      it("calculates flow rate: soaker_length_ft × soaker_gph_per_ft", () => {
        // 100 ft soaker × 0.5 gph/ft = 50 gph
        const result = calculateFlowGph("soaker", {
          soaker_length_ft: 100,
          soaker_gph_per_ft: 0.5,
        });
        expect(result.gph).toBe(50);
      });

      it("handles zero length", () => {
        const result = calculateFlowGph("soaker", {
          soaker_length_ft: 0,
          soaker_gph_per_ft: 0.5,
        });
        expect(result.gph).toBe(0);
      });
    });

    it("throws error for unknown irrigation method", () => {
      expect(() =>
        calculateFlowGph("unknown" as IrrigationMethod, {})
      ).toThrow("Unknown irrigation method");
    });
  });

  describe("runtimeMinutes", () => {
    it("calculates runtime: (gal / gph) × 60 = minutes, capped at default 60 min", () => {
      // 100 gal / 50 gph × 60 = 120 minutes, capped at default maxSingleRunMin of 60
      const result = runtimeMinutes(100, 50);
      expect(result.runtime_min).toBe(60); // Capped by default
    });

    it("calculates runtime without cap when maxSingleRunMin is large", () => {
      // 100 gal / 50 gph × 60 = 120 minutes, with maxSingleRunMin = 200
      const result = runtimeMinutes(100, 50, 200);
      expect(result.runtime_min).toBe(120);
    });

    it("returns valve-open minutes only (no soak inflation)", () => {
      // regression: cycle-soak once doubled water delivery
      // The runtime returned must be ONLY the valve-open time, not including any soak time
      const result = runtimeMinutes(50, 100); // 50 gal / 100 gph = 0.5 hr = 30 min
      expect(result.runtime_min).toBe(30);
      expect(result.requires_cycle_soak).toBe(false);
      expect(result.cycles).toBeUndefined();
    });

    it("caps runtime at maxSingleRunMin (default 60)", () => {
      // 300 gal / 60 gph = 300 minutes, capped at 60
      const result = runtimeMinutes(300, 60);
      expect(result.runtime_min).toBe(60);
    });

    it("accepts custom maxSingleRunMin", () => {
      // 300 gal / 60 gph = 300 minutes, capped at 120
      const result = runtimeMinutes(300, 60, 120);
      expect(result.runtime_min).toBe(120);
    });

    it("rounds runtime up via Math.ceil", () => {
      // 10 gal / 60 gph × 60 = 10 minutes
      const result = runtimeMinutes(10, 60);
      expect(result.runtime_min).toBe(10);
    });

    it("throws error for zero or negative flow rate", () => {
      expect(() => runtimeMinutes(100, 0)).toThrow("Flow rate must be positive");
      expect(() => runtimeMinutes(100, -10)).toThrow("Flow rate must be positive");
    });

    it("handles very small flow rates", () => {
      // 100 gal / 0.1 gph = 1000 min, capped at 60
      const result = runtimeMinutes(100, 0.1);
      expect(result.runtime_min).toBe(60);
    });

    it("handles zero gallons needed", () => {
      const result = runtimeMinutes(0, 100);
      expect(result.runtime_min).toBe(0);
    });
  });

  describe("constrainRuntime", () => {
    it("leaves runtime unchanged if under max", () => {
      const input: RuntimeResult = {
        runtime_min: 30,
        requires_cycle_soak: false,
      };
      const result = constrainRuntime(input, 60);
      expect(result.runtime_min).toBe(30);
    });

    it("caps runtime if over max", () => {
      const input: RuntimeResult = {
        runtime_min: 120,
        requires_cycle_soak: false,
      };
      const result = constrainRuntime(input, 60);
      expect(result.runtime_min).toBe(60);
    });

    it("handles runtime equal to max", () => {
      const input: RuntimeResult = {
        runtime_min: 60,
        requires_cycle_soak: false,
      };
      const result = constrainRuntime(input, 60);
      expect(result.runtime_min).toBe(60);
    });

    it("preserves other fields in result", () => {
      const input: RuntimeResult = {
        runtime_min: 120,
        requires_cycle_soak: false,
        cycles: undefined,
      };
      const result = constrainRuntime(input, 60);
      expect(result.requires_cycle_soak).toBe(false);
    });
  });

  describe("integration: flow rate + runtime", () => {
    it("drip zone: 10 emitters × 0.5 gph = 5 gph, 50 gal = 600 min (capped at 60)", () => {
      const flow = calculateFlowGph("drip", {
        emitter_count: 10,
        emitter_gph: 0.5,
      });
      const result = runtimeMinutes(50, flow.gph);
      expect(result.runtime_min).toBe(60); // (50 / 5) * 60 = 600, capped at 60
    });

    it("spray zone: 8 heads × 0.75 gpm = 360 gph, 50 gal = 8.33 min", () => {
      const flow = calculateFlowGph("spray", {
        head_count: 8,
        head_gpm: 0.75,
      });
      const result = runtimeMinutes(50, flow.gph);
      // (50 / 360) * 60 = 8.33... → 9 min
      expect(result.runtime_min).toBe(9);
    });
  });

  describe("edge cases", () => {
    it("handles fractional gallons", () => {
      const result = runtimeMinutes(15.5, 50);
      // 15.5 / 50 * 60 = 18.6 → 19 min
      expect(result.runtime_min).toBe(19);
    });

    it("handles fractional flow rates", () => {
      const result = runtimeMinutes(100, 33.33);
      // 100 / 33.33 * 60 = 180.018... → 181 min, capped at 60
      expect(result.runtime_min).toBe(60);
    });

    it("regression: valve-open only - verify no soak is included", () => {
      // The entire point: runtime returned is JUST valve-open time
      // If soak time were accidentally included, this would fail regression
      const result = runtimeMinutes(50, 100); // 30 min valve open
      expect(result.runtime_min).toBe(30);
      expect(result.cycles).toBeUndefined(); // No cycle data for v1
    });
  });
});
