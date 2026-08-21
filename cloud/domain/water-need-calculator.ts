// Water need calculator with lookup table approach
// Each zone type has a weekly depth requirement; converts to gallons/week

export type ZoneType =
  | "cool-season-turf"
  | "warm-season-turf"
  | "vegetable"
  | "shrub"
  | "xeric"
  | "trees";

interface ZoneTypeSpec {
  label: string;
  weeklyDepthInches: [number, number]; // [min, max]
  galPerWeekPerSqFt: [number, number]; // [min, max] using 0.623 conversion
  source: string;
}

const zoneTypeLookup: Record<ZoneType, ZoneTypeSpec> = {
  "cool-season-turf": {
    label: "Cool-season turf",
    weeklyDepthInches: [1.0, 1.5],
    galPerWeekPerSqFt: [0.62, 0.93],
    source: "lookup table - cool-season turf",
  },
  "warm-season-turf": {
    label: "Warm-season turf",
    weeklyDepthInches: [0.5, 1.0],
    galPerWeekPerSqFt: [0.31, 0.62],
    source: "lookup table - warm-season turf",
  },
  vegetable: {
    label: "Vegetable garden",
    weeklyDepthInches: [1.0, 1.5],
    galPerWeekPerSqFt: [0.62, 0.93],
    source: "lookup table - vegetable",
  },
  shrub: {
    label: "Shrub bed",
    weeklyDepthInches: [0.5, 0.5],
    galPerWeekPerSqFt: [0.31, 0.31],
    source: "lookup table - shrub",
  },
  xeric: {
    label: "Native/xeric bed",
    weeklyDepthInches: [0.25, 0.25],
    galPerWeekPerSqFt: [0.16, 0.16],
    source: "lookup table - xeric",
  },
  trees: {
    label: "Trees",
    weeklyDepthInches: [5, 10], // gal/inch trunk diameter/week, not depth
    galPerWeekPerSqFt: [5, 10],
    source: "lookup table - trees (gal/inch trunk diameter)",
  },
};

export interface GalPerWeekResult {
  gal_per_week: number;
  source: string;
}

/**
 * Calculate gallons per week for an area-based zone (turf, beds, etc.)
 * Formula: area_sqft × depth_in × 0.623 = gal
 */
export function galPerWeekAreaBased(
  zoneType: ZoneType,
  areaSqFt: number,
  depthInches?: number
): GalPerWeekResult {
  const spec = zoneTypeLookup[zoneType];
  if (!spec) throw new Error(`Unknown zone type: ${zoneType}`);

  // Use provided depth or default to midpoint
  const depth = depthInches ?? (spec.weeklyDepthInches[0] + spec.weeklyDepthInches[1]) / 2;

  const gallons = areaSqFt * depth * 0.623;

  return {
    gal_per_week: Math.round(gallons * 100) / 100, // 2 decimal places
    source: spec.source,
  };
}

/**
 * Calculate gallons per week for per-plant basis (trees, shrubs, etc.)
 * Per-plant defaults vary by species
 */
export function galPerWeekPerPlant(
  zoneType: ZoneType,
  quantity: number,
  galPerWeekPerPlant?: number
): GalPerWeekResult {
  const spec = zoneTypeLookup[zoneType];
  if (!spec) throw new Error(`Unknown zone type: ${zoneType}`);

  // Default per-plant rates (in gal/week)
  const defaults: Record<ZoneType, number> = {
    "cool-season-turf": 0, // Not typically per-plant
    "warm-season-turf": 0,
    vegetable: 1.25, // Tomato/typical veg: 1-1.5 gal/wk
    shrub: 3.5, // Mature shrub: 2-5 gal/wk
    xeric: 1.0, // Smaller xeric plants
    trees: 7.5, // Typical tree: 5-10 gal/wk
  };

  const perPlantGal = galPerWeekPerPlant ?? defaults[zoneType];
  const totalGal = perPlantGal * quantity;

  return {
    gal_per_week: Math.round(totalGal * 100) / 100,
    source: galerSourcePerPlant(zoneType, galPerWeekPerPlant),
  };
}

function galerSourcePerPlant(zoneType: ZoneType, custom?: number): string {
  if (custom !== undefined) {
    return `custom ${custom} gal/week × quantity`;
  }
  const spec = zoneTypeLookup[zoneType];
  return `${spec.label} default per-plant rate`;
}

/**
 * Get available zone types for UI dropdown
 */
export function getZoneTypes(): Array<{ value: ZoneType; label: string }> {
  return Object.entries(zoneTypeLookup).map(([value, spec]) => ({
    value: value as ZoneType,
    label: spec.label,
  }));
}

/**
 * Get the range of gal/week for a zone type and area
 */
export function galPerWeekRange(zoneType: ZoneType, areaSqFt: number): [number, number] {
  const spec = zoneTypeLookup[zoneType];
  if (!spec) throw new Error(`Unknown zone type: ${zoneType}`);

  const min = Math.round(areaSqFt * spec.weeklyDepthInches[0] * 0.623 * 100) / 100;
  const max = Math.round(areaSqFt * spec.weeklyDepthInches[1] * 0.623 * 100) / 100;

  return [min, max];
}
