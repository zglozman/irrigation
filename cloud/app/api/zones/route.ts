// GET /api/zones — list all zones with budget info
// POST /api/zones — create a new zone

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getZones,
  getPlantConfig,
  getBudget,
  getSchedule,
  putZone,
  putPlantConfig,
  putBudget,
  ZoneItem,
  PlantConfigItem,
  BudgetItem,
} from "@/lib/dynamo";
import { v4 as uuidv4 } from "uuid";

export async function GET(_request: NextRequest) {
  try {
    const user = await requireUser();

    // Get all zones
    const zones = await getZones(user.sub);

    // Enrich with plant config, budget, and current schedule (the dashboard's
    // "watering now" indicator reads schedule.status)
    const enriched = await Promise.all(
      zones.map(async (zone) => {
        const plantConfig = await getPlantConfig(user.sub, zone.zone_id);
        const budget = await getBudget(user.sub, zone.zone_id);
        const schedule = await getSchedule(user.sub, zone.zone_id);

        return {
          ...zone,
          plantConfig: plantConfig || null,
          budget: budget || null,
          schedule: schedule || null,
        };
      })
    );

    return NextResponse.json(enriched, { status: 200 });
  } catch (error) {
    console.error("[Zones] GET error:", error);
    const message = error instanceof Error ? error.message : "Failed to get zones";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = await request.json();

    const {
      relay_channel,
      name,
      area_sqft,
      location,
      zone_type,
      irrigation_method,
      emitter_count,
      emitter_gph,
      head_count,
      head_gpm,
      soaker_length_ft,
      soaker_gph_per_ft,
      plant_quantity,
      gal_per_week_per_plant,
      weekly_target_gal,
    } = body;

    if (!relay_channel || !name || !area_sqft || !zone_type || !irrigation_method) {
      return NextResponse.json(
        {
          error:
            "relay_channel, name, area_sqft, zone_type, and irrigation_method are required",
        },
        { status: 400 }
      );
    }

    const zoneId = uuidv4().slice(0, 8); // Short UUID for zone ID

    // Create zone
    const zone: Omit<ZoneItem, "PK" | "SK"> = {
      zone_id: zoneId,
      relay_channel,
      name,
      area_sqft,
      location: location || "",
    };

    // Create plant config
    const plantConfig: Omit<PlantConfigItem, "PK" | "SK"> = {
      zone_id: zoneId,
      zone_type,
      irrigation_method,
      emitter_count,
      emitter_gph,
      head_count,
      head_gpm,
      soaker_length_ft,
      soaker_gph_per_ft,
      plant_quantity,
      gal_per_week_per_plant,
      total_gal_per_week: weekly_target_gal || 0,
      gal_week_source: "custom",
    };

    // Create budget (weekly reset)
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - ((now.getDay() + 6) % 7)); // Monday
    weekStart.setHours(0, 0, 0, 0);

    const budget: Omit<BudgetItem, "PK" | "SK"> = {
      zone_id: zoneId,
      weekly_target_gal: weekly_target_gal || 0,
      delivered_gal_this_week: 0,
      rainfall_gal_this_week: 0,
      week_start_date: weekStart.toISOString().split("T")[0],
      last_updated: now.toISOString(),
    };

    await Promise.all([
      putZone(user.sub, zone),
      putPlantConfig(user.sub, plantConfig),
      putBudget(user.sub, budget),
    ]);

    return NextResponse.json(
      { ...zone, plantConfig, budget },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Zones] POST error:", error);
    const message = error instanceof Error ? error.message : "Failed to create zone";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
