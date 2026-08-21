// GET /api/zones/[id] — get zone details
// PUT /api/zones/[id] — update zone
// DELETE /api/zones/[id] — delete zone

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getZone,
  getPlantConfig,
  getBudget,
  putZone,
  putPlantConfig,
  deleteZone,
} from "@/lib/dynamo";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id: zoneId } = await params;

    const zone = await getZone(user.sub, zoneId);
    if (!zone) {
      return NextResponse.json({ error: "Zone not found" }, { status: 404 });
    }

    const plantConfig = await getPlantConfig(user.sub, zoneId);
    const budget = await getBudget(user.sub, zoneId);

    return NextResponse.json({
      ...zone,
      plantConfig,
      budget,
    });
  } catch (error) {
    console.error("[Zone] GET error:", error);
    const message = error instanceof Error ? error.message : "Failed to get zone";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id: zoneId } = await params;
    const body = await request.json();

    // Get existing zone
    const zone = await getZone(user.sub, zoneId);
    if (!zone) {
      return NextResponse.json({ error: "Zone not found" }, { status: 404 });
    }

    // Update zone fields
    const updated = {
      ...zone,
      ...body,
      zone_id: zoneId, // Don't allow changing zone ID
    };

    // Update plant config if provided
    if (body.plantConfig) {
      await putPlantConfig(user.sub, {
        ...body.plantConfig,
        zone_id: zoneId,
      });
    }

    // Update zone
    await putZone(user.sub, {
      zone_id: updated.zone_id,
      relay_channel: updated.relay_channel,
      name: updated.name,
      area_sqft: updated.area_sqft,
      location: updated.location,
    });

    const plantConfig = await getPlantConfig(user.sub, zoneId);
    const budget = await getBudget(user.sub, zoneId);

    return NextResponse.json({
      ...updated,
      plantConfig,
      budget,
    });
  } catch (error) {
    console.error("[Zone] PUT error:", error);
    const message = error instanceof Error ? error.message : "Failed to update zone";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id: zoneId } = await params;

    // Check if zone exists
    const zone = await getZone(user.sub, zoneId);
    if (!zone) {
      return NextResponse.json({ error: "Zone not found" }, { status: 404 });
    }

    await deleteZone(user.sub, zoneId);

    return NextResponse.json(
      { success: true, message: "Zone deleted" },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Zone] DELETE error:", error);
    const message = error instanceof Error ? error.message : "Failed to delete zone";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
