// Irrigation log entry types and utilities

export type TriggerType = "SCHEDULED" | "MANUAL" | "SKIPPED" | "DELAYED" | "REDUCED" | "FAILED";
export type OutcomeType = "RAN" | "SCHEDULED" | "SKIPPED" | "DELAYED" | "REDUCED" | "FAILED";

export interface WeatherSnapshot {
  temp_f?: number;
  wind_mph?: number;
  precip_prob?: number; // 0-1
  precip_in?: number;
}

export interface IrrigationLogEntry {
  zone_id: string;
  relay_channel: number; // 1-16, used for S3 partition
  timestamp: string; // ISO timestamp
  trigger_type: TriggerType;
  scheduled_runtime_min: number;
  actual_runtime_min?: number;
  gallons_estimated_delivered: number;
  weekly_target_gal: number;
  remaining_before: number; // Changed from remaining_before_gal
  remaining_after: number; // Changed from remaining_after_gal
  rainfall_measured_in: number;
  rainfall_gal_equiv: number;
  weather_snapshot: WeatherSnapshot;
  outcome: OutcomeType;
  reason: string;
}

/**
 * Builder pattern for creating log entries
 */
export class IrrigationLogBuilder {
  private entry: Partial<IrrigationLogEntry> = {
    weather_snapshot: {},
  };

  zoneId(id: string): this {
    this.entry.zone_id = id;
    return this;
  }

  relayChannel(channel: number): this {
    this.entry.relay_channel = channel;
    return this;
  }

  timestamp(ts: string | Date): this {
    this.entry.timestamp = typeof ts === "string" ? ts : ts.toISOString();
    return this;
  }

  triggerType(type: TriggerType): this {
    this.entry.trigger_type = type;
    return this;
  }

  scheduledRuntimeMin(min: number): this {
    this.entry.scheduled_runtime_min = min;
    return this;
  }

  actualRuntimeMin(min: number): this {
    this.entry.actual_runtime_min = min;
    return this;
  }

  gallonsDelivered(gal: number): this {
    this.entry.gallons_estimated_delivered = gal;
    return this;
  }

  weeklyTargetGal(gal: number): this {
    this.entry.weekly_target_gal = gal;
    return this;
  }

  remainingBefore(gal: number): this {
    this.entry.remaining_before = gal;
    return this;
  }

  remainingAfter(gal: number): this {
    this.entry.remaining_after = gal;
    return this;
  }

  rainfallMeasuredIn(in_val: number): this {
    this.entry.rainfall_measured_in = in_val;
    return this;
  }

  rainfallGalEquiv(gal: number): this {
    this.entry.rainfall_gal_equiv = gal;
    return this;
  }

  weatherSnapshot(snapshot: WeatherSnapshot): this {
    this.entry.weather_snapshot = snapshot;
    return this;
  }

  outcome(outcome: OutcomeType): this {
    this.entry.outcome = outcome;
    return this;
  }

  reason(text: string): this {
    this.entry.reason = text;
    return this;
  }

  build(): IrrigationLogEntry {
    // Validate all required fields
    if (!this.entry.zone_id) throw new Error("zoneId is required");
    if (this.entry.relay_channel === undefined)
      throw new Error("relayChannel is required");
    if (!this.entry.timestamp) throw new Error("timestamp is required");
    if (!this.entry.trigger_type) throw new Error("triggerType is required");
    if (this.entry.scheduled_runtime_min === undefined)
      throw new Error("scheduledRuntimeMin is required");
    if (this.entry.gallons_estimated_delivered === undefined)
      throw new Error("gallonsDelivered is required");
    if (this.entry.weekly_target_gal === undefined)
      throw new Error("weeklyTargetGal is required");
    if (this.entry.remaining_before === undefined)
      throw new Error("remainingBefore is required");
    if (this.entry.remaining_after === undefined)
      throw new Error("remainingAfter is required");
    if (this.entry.rainfall_measured_in === undefined)
      throw new Error("rainfallMeasuredIn is required");
    if (this.entry.rainfall_gal_equiv === undefined)
      throw new Error("rainfallGalEquiv is required");
    if (!this.entry.outcome) throw new Error("outcome is required");
    if (!this.entry.reason) throw new Error("reason is required");

    return this.entry as IrrigationLogEntry;
  }
}
