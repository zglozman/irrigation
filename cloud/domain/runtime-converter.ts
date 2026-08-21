// Runtime converter: gallons needed + flow rate => runtime in minutes
// Handles cycle-soak splitting for long runs

export type IrrigationMethod = "drip" | "spray" | "soaker";

export interface FlowResult {
  gph: number; // gallons per hour
}

/**
 * Calculate flow rate (gal/hour) from irrigation method and equipment specs
 */
export function calculateFlowGph(method: IrrigationMethod, specs: Record<string, number>): FlowResult {
  switch (method) {
    case "drip": {
      // Drip: emitter_count × emitter_gph
      const emitterCount = specs.emitter_count || 0;
      const emitterGph = specs.emitter_gph || 0;
      return { gph: emitterCount * emitterGph };
    }

    case "spray": {
      // Spray: head_count × head_gpm × 60 (convert gpm to gph)
      const headCount = specs.head_count || 0;
      const headGpm = specs.head_gpm || 0;
      return { gph: headCount * headGpm * 60 };
    }

    case "soaker": {
      // Soaker: soaker_length_ft × soaker_gph_per_ft
      const length = specs.soaker_length_ft || 0;
      const gphPerFt = specs.soaker_gph_per_ft || 0;
      return { gph: length * gphPerFt };
    }

    default:
      throw new Error(`Unknown irrigation method: ${method}`);
  }
}

export interface RuntimeResult {
  runtime_min: number;
  cycles?: Array<{
    cycle_number: number;
    cycle_runtime_min: number;
    soak_after_min: number;
  }>;
  requires_cycle_soak: boolean;
}

/**
 * Calculate runtime in minutes from gallons needed and flow rate
 * Returns VALVE-OPEN minutes only (no soak time included).
 * For v1, does not execute multi-cycle runs - single runs are capped elsewhere.
 * Cycle-soak infrastructure is kept but not used operationally.
 */
export function runtimeMinutes(gallonsNeeded: number, flowGph: number, maxSingleRunMin: number = 60): RuntimeResult {
  if (flowGph <= 0) {
    throw new Error("Flow rate must be positive");
  }

  // Base runtime = (gallons / flow_gph) × 60
  // This is VALVE-OPEN time only
  const baseRuntimeMin = (gallonsNeeded / flowGph) * 60;

  // For v1, return valve-open runtime only, capped at maxSingleRunMin
  // Actual 55-minute cap is applied in the scheduler
  const cappedRuntime = Math.min(baseRuntimeMin, maxSingleRunMin);

  return {
    runtime_min: Math.ceil(cappedRuntime),
    requires_cycle_soak: false,
    cycles: undefined, // Not used for v1
  };
}

/**
 * Constrain runtime to a maximum allowed, with cycle-soak if needed
 */
export function constrainRuntime(
  runtimeResult: RuntimeResult,
  maxRuntimeMin: number
): RuntimeResult {
  // If already under max, no constraint needed
  if (runtimeResult.runtime_min <= maxRuntimeMin) {
    return runtimeResult;
  }

  // Cap the total runtime
  return {
    ...runtimeResult,
    runtime_min: Math.min(runtimeResult.runtime_min, maxRuntimeMin),
  };
}
