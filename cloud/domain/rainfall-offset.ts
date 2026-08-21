// Rainfall offset calculator
// Converts rainfall to gallons and updates remaining irrigation target

export interface RainfallOffsetResult {
  rain_gal: number;
  remaining_target_gal: number;
}

/**
 * Calculate gallons of water from rainfall
 * Formula: area_sqft × rainfall_in × 0.623 = gal
 * (0.623 = 1 gal / (12 in × 12 in × density of water in lb/gal))
 */
export function rainfallGallons(areaSqFt: number, rainfallIn: number): number {
  const rainGal = areaSqFt * rainfallIn * 0.623;
  return Math.round(rainGal * 100) / 100; // 2 decimal places
}

/**
 * Calculate remaining irrigation target after accounting for rainfall and delivered water
 * remaining = max(0, target - rain_gal - delivered_gal)
 */
export function remainingTarget(
  targetGal: number,
  rainfallGal: number,
  deliveredGal: number
): number {
  const remaining = Math.max(0, targetGal - rainfallGal - deliveredGal);
  return Math.round(remaining * 100) / 100;
}

/**
 * Complete rainfall offset calculation
 */
export function calculateRainfallOffset(
  areaSqFt: number,
  rainfallIn: number,
  targetGal: number,
  deliveredGal: number
): RainfallOffsetResult {
  const rainGal = rainfallGallons(areaSqFt, rainfallIn);
  const remaining = remainingTarget(targetGal, rainGal, deliveredGal);

  return {
    rain_gal: rainGal,
    remaining_target_gal: remaining,
  };
}
