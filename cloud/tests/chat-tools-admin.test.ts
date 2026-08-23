import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  executeTool,
} from "@/lib/chat/tools";
import * as dynamo from "@/lib/dynamo";
import * as mqtt from "@/lib/iot-mqtt";
import * as waterCalc from "@/domain/water-need-calculator";

// Mock all the modules
vi.mock("@/lib/dynamo");
vi.mock("@/lib/iot-mqtt");
vi.mock("@/lib/s3-logs");
vi.mock("@/jobs/reevaluate-schedule");
vi.mock("@/domain/water-need-calculator");
vi.mock("@/lib/athena");
vi.mock("@/weather");
vi.mock("uuid", () => ({
  v4: () => "12345678-abcd-abcd-abcd-abcdefghijkl",
}));
vi.mock("@aws-sdk/client-cognito-identity-provider");

const mockUserSub = "test-user-123";

describe("chat-tools-admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create_zone", () => {
    it("creates zone with area-based target calculation", async () => {
      // Mocks
      vi.mocked(dynamo.getZones).mockResolvedValue([] as any);
      vi.mocked(waterCalc.galPerWeekAreaBased).mockReturnValue({
        gal_per_week: 77.88,
        source: "lookup table - vegetable",
      });
      vi.mocked(dynamo.putZone).mockResolvedValue(undefined);
      vi.mocked(dynamo.putPlantConfig).mockResolvedValue(undefined);
      vi.mocked(dynamo.putBudget).mockResolvedValue(undefined);

      const input = {
        name: "Veggie Bed",
        relay_channel: 1,
        area_sqft: 100,
        zone_type: "vegetable",
        irrigation_method: "drip",
        emitter_count: 10,
        emitter_gph: 2,
      };

      const result = JSON.parse(await executeTool(mockUserSub, "create_zone", input));

      expect(result.success).toBe(true);
      expect(result.name).toBe("Veggie Bed");
      expect(result.weekly_target_gal).toBe(77.88);
      expect(result.weekly_target_source).toBe("area-based");
      expect(vi.mocked(dynamo.putZone)).toHaveBeenCalled();
      expect(vi.mocked(dynamo.putPlantConfig)).toHaveBeenCalled();
      expect(vi.mocked(dynamo.putBudget)).toHaveBeenCalled();
    });

    it("rejects relay channel conflict before any write", async () => {
      const existingZone = {
        zone_id: "existing",
        relay_channel: 1,
        name: "Front Lawn",
        area_sqft: 500,
        location: "",
      };
      vi.mocked(dynamo.getZones).mockResolvedValue([existingZone] as any);

      const input = {
        name: "Back Lawn",
        relay_channel: 1,
        area_sqft: 300,
        zone_type: "cool-season-turf",
        irrigation_method: "spray",
      };

      const result = JSON.parse(await executeTool(mockUserSub, "create_zone", input));

      expect(result.error).toContain("already in use");
      expect(result.error).toContain("Front Lawn");
      // Verify no write was attempted
      expect(vi.mocked(dynamo.putZone)).not.toHaveBeenCalled();
      expect(vi.mocked(dynamo.putPlantConfig)).not.toHaveBeenCalled();
      expect(vi.mocked(dynamo.putBudget)).not.toHaveBeenCalled();
    });

    it("rejects invalid zone_type before any write", async () => {
      vi.mocked(dynamo.getZones).mockResolvedValue([] as any);

      const input = {
        name: "Mystery Zone",
        relay_channel: 5,
        area_sqft: 100,
        zone_type: "invalid-zone-type",
        irrigation_method: "drip",
      };

      const result = JSON.parse(await executeTool(mockUserSub, "create_zone", input));

      expect(result.error).toContain("zone_type must be one of");
      // Verify no write was attempted
      expect(vi.mocked(dynamo.putZone)).not.toHaveBeenCalled();
    });

    it("uses custom weekly_target_gal when provided", async () => {
      vi.mocked(dynamo.getZones).mockResolvedValue([] as any);
      vi.mocked(dynamo.putZone).mockResolvedValue(undefined);
      vi.mocked(dynamo.putPlantConfig).mockResolvedValue(undefined);
      vi.mocked(dynamo.putBudget).mockResolvedValue(undefined);

      const input = {
        name: "Custom Zone",
        relay_channel: 3,
        area_sqft: 100,
        zone_type: "shrub",
        irrigation_method: "drip",
        weekly_target_gal: 50,
      };

      const result = JSON.parse(await executeTool(mockUserSub, "create_zone", input));

      expect(result.success).toBe(true);
      expect(result.weekly_target_gal).toBe(50);
      expect(result.weekly_target_source).toBe("custom");
    });

    it("validates relay_channel is between 1-16", async () => {
      const inputs = [
        { ...getValidCreateInput(), relay_channel: 0 },
        { ...getValidCreateInput(), relay_channel: 17 },
        { ...getValidCreateInput(), relay_channel: -1 },
      ];

      for (const input of inputs) {
        const result = JSON.parse(await executeTool(mockUserSub, "create_zone", input));
        expect(result.error).toContain("between 1 and 16");
        expect(vi.mocked(dynamo.putZone)).not.toHaveBeenCalled();
      }
    });

    it("validates area_sqft is positive", async () => {
      const inputs = [
        { ...getValidCreateInput(), area_sqft: 0 },
        { ...getValidCreateInput(), area_sqft: -100 },
      ];

      for (const input of inputs) {
        const result = JSON.parse(await executeTool(mockUserSub, "create_zone", input));
        expect(result.error).toContain("must be greater than 0");
        expect(vi.mocked(dynamo.putZone)).not.toHaveBeenCalled();
      }
    });
  });

  describe("update_zone", () => {
    it("updates zone fields when provided", async () => {
      const existingZone = {
        zone_id: "zone1",
        relay_channel: 1,
        name: "Old Name",
        area_sqft: 100,
        location: "",
      };
      vi.mocked(dynamo.getZone).mockResolvedValue(existingZone as any);
      vi.mocked(dynamo.getZones).mockResolvedValue([existingZone] as any);
      vi.mocked(dynamo.getPlantConfig).mockResolvedValue(null as any);
      vi.mocked(dynamo.putZone).mockResolvedValue(undefined);
      vi.mocked(dynamo.getBudget).mockResolvedValue(null);

      const input = {
        zone_id: "zone1",
        name: "New Name",
        area_sqft: 200,
      };

      const result = JSON.parse(await executeTool(mockUserSub, "update_zone", input));

      expect(result.success).toBe(true);
      expect(vi.mocked(dynamo.putZone)).toHaveBeenCalledWith(mockUserSub, expect.objectContaining({
        name: "New Name",
        area_sqft: 200,
      }));
    });

    it("rejects relay channel conflict when changing relay_channel", async () => {
      const zone1 = { zone_id: "zone1", relay_channel: 1, name: "Zone 1", area_sqft: 100, location: "" } as any;
      const zone2 = { zone_id: "zone2", relay_channel: 2, name: "Zone 2", area_sqft: 100, location: "" } as any;

      vi.mocked(dynamo.getZone).mockResolvedValue(zone1);
      vi.mocked(dynamo.getZones).mockResolvedValue([zone1, zone2]);

      const input = {
        zone_id: "zone1",
        relay_channel: 2, // Conflict with zone2
      };

      const result = JSON.parse(await executeTool(mockUserSub, "update_zone", input));

      expect(result.error).toContain("already in use");
      expect(vi.mocked(dynamo.putZone)).not.toHaveBeenCalled();
    });

    it("updates budget when weekly_target_gal is provided", async () => {
      const zone = { zone_id: "zone1", relay_channel: 1, name: "Zone", area_sqft: 100, location: "" } as any;
      const oldBudget = {
        zone_id: "zone1",
        weekly_target_gal: 50,
        delivered_gal_this_week: 10,
        rainfall_gal_this_week: 5,
        week_start_date: "2026-08-20",
        last_updated: "2026-08-20T00:00:00Z",
      };

      vi.mocked(dynamo.getZone).mockResolvedValue(zone);
      vi.mocked(dynamo.getZones).mockResolvedValue([zone]);
      vi.mocked(dynamo.getPlantConfig).mockResolvedValue(null as any);
      vi.mocked(dynamo.getBudget).mockResolvedValue(oldBudget as any);
      vi.mocked(dynamo.putZone).mockResolvedValue(undefined);
      vi.mocked(dynamo.putBudget).mockResolvedValue(undefined);

      const input = {
        zone_id: "zone1",
        weekly_target_gal: 100,
      };

      const result = JSON.parse(await executeTool(mockUserSub, "update_zone", input));

      expect(result.success).toBe(true);
      expect(vi.mocked(dynamo.putBudget)).toHaveBeenCalledWith(
        mockUserSub,
        expect.objectContaining({
          weekly_target_gal: 100,
        })
      );
    });

    it("rejects unknown zone", async () => {
      vi.mocked(dynamo.getZone).mockResolvedValue(null);

      const input = {
        zone_id: "nonexistent",
        name: "New Name",
      };

      const result = JSON.parse(await executeTool(mockUserSub, "update_zone", input));

      expect(result.error).toContain("not found");
    });
  });

  describe("delete_zone", () => {
    it("deletes zone when no active schedule", async () => {
      const zone = { zone_id: "zone1", relay_channel: 1, name: "Zone", area_sqft: 100, location: "" };
      vi.mocked(dynamo.getZone).mockResolvedValue(zone as any);
      vi.mocked(dynamo.getSchedule).mockResolvedValue(null as any);
      vi.mocked(dynamo.deleteZone).mockResolvedValue(undefined);

      const input = { zone_id: "zone1" };
      const result = JSON.parse(await executeTool(mockUserSub, "delete_zone", input));

      expect(result.success).toBe(true);
      expect(vi.mocked(dynamo.deleteZone)).toHaveBeenCalledWith(mockUserSub, "zone1");
    });

    it("refuses to delete zone with ACTIVE schedule", async () => {
      const zone = { zone_id: "zone1", relay_channel: 1, name: "Zone", area_sqft: 100, location: "" };
      const activeSchedule = {
        zone_id: "zone1",
        relay_channel: 1,
        scheduled_start: "2026-08-20T10:00:00Z",
        scheduled_runtime_min: 30,
        scheduled_end: "2026-08-20T10:30:00Z",
        trigger_reason: "manual",
        status: "ACTIVE" as const,
      };

      vi.mocked(dynamo.getZone).mockResolvedValue(zone as any);
      vi.mocked(dynamo.getSchedule).mockResolvedValue(activeSchedule as any);

      const input = { zone_id: "zone1" };
      const result = JSON.parse(await executeTool(mockUserSub, "delete_zone", input));

      expect(result.error).toContain("ACTIVE");
      expect(vi.mocked(dynamo.deleteZone)).not.toHaveBeenCalled();
    });

    it("rejects unknown zone", async () => {
      vi.mocked(dynamo.getZone).mockResolvedValue(null);

      const input = { zone_id: "nonexistent" };
      const result = JSON.parse(await executeTool(mockUserSub, "delete_zone", input));

      expect(result.error).toContain("not found");
      expect(vi.mocked(dynamo.deleteZone)).not.toHaveBeenCalled();
    });
  });

  describe("set_relay", () => {
    it("validates channel is 1-16", async () => {
      const channels = [0, -1, 17, 100, 1.5, "invalid"];

      for (const channel of channels) {
        vi.mocked(mqtt.commandRelay).mockResolvedValue(undefined);
        const input = { channel, on: true };
        const result = JSON.parse(await executeTool(mockUserSub, "set_relay", input));
        expect(result).toHaveProperty("error");
        expect(result.error).toContain("between 1 and 16");
        expect(vi.mocked(mqtt.commandRelay)).not.toHaveBeenCalled();
      }
    });

    it("validates on is boolean", async () => {
      const values = [1, 0, "true", "false", null];

      for (const on of values) {
        vi.mocked(mqtt.commandRelay).mockResolvedValue(undefined);
        const input = { channel: 1, on };
        const result = JSON.parse(await executeTool(mockUserSub, "set_relay", input));
        expect(result.error).toContain("boolean");
        expect(vi.mocked(mqtt.commandRelay)).not.toHaveBeenCalled();
      }
    });

    it("commands relay to ON", async () => {
      vi.mocked(mqtt.commandRelay).mockResolvedValue(undefined);
      const input = { channel: 5, on: true };
      const result = JSON.parse(await executeTool(mockUserSub, "set_relay", input));

      expect(result.success).toBe(true);
      expect(vi.mocked(mqtt.commandRelay)).toHaveBeenCalledWith(5, true);
    });

    it("commands relay to OFF", async () => {
      vi.mocked(mqtt.commandRelay).mockResolvedValue(undefined);
      const input = { channel: 3, on: false };
      const result = JSON.parse(await executeTool(mockUserSub, "set_relay", input));

      expect(result.success).toBe(true);
      expect(vi.mocked(mqtt.commandRelay)).toHaveBeenCalledWith(3, false);
    });
  });

  describe("set_weekly_target", () => {
    it("updates both budget and plant config", async () => {
      const zone = { zone_id: "zone1", relay_channel: 1, name: "Zone", area_sqft: 100, location: "" };
      const oldBudget = {
        zone_id: "zone1",
        weekly_target_gal: 50,
        delivered_gal_this_week: 10,
        rainfall_gal_this_week: 5,
        week_start_date: "2026-08-20",
        last_updated: "2026-08-20T00:00:00Z",
      };
      const plantConfig = {
        zone_id: "zone1",
        zone_type: "vegetable",
        irrigation_method: "drip",
        total_gal_per_week: 50,
        gal_week_source: "lookup table - vegetable",
      };

      vi.mocked(dynamo.getZone).mockResolvedValue(zone as any);
      vi.mocked(dynamo.getBudget).mockResolvedValue(oldBudget as any);
      vi.mocked(dynamo.getPlantConfig).mockResolvedValue(plantConfig as any);
      vi.mocked(dynamo.putBudget).mockResolvedValue(undefined);
      vi.mocked(dynamo.putPlantConfig).mockResolvedValue(undefined);

      const input = { zone_id: "zone1", gallons: 100 };
      const result = JSON.parse(await executeTool(mockUserSub, "set_weekly_target", input));

      expect(result.success).toBe(true);
      expect(result.old_target_gal).toBe(50);
      expect(result.new_target_gal).toBe(100);
      expect(vi.mocked(dynamo.putBudget)).toHaveBeenCalledWith(
        mockUserSub,
        expect.objectContaining({
          weekly_target_gal: 100,
        })
      );
      expect(vi.mocked(dynamo.putPlantConfig)).toHaveBeenCalledWith(
        mockUserSub,
        expect.objectContaining({
          total_gal_per_week: 100,
          gal_week_source: "custom",
        })
      );
    });

    it("validates gallons is non-negative", async () => {
      const zone = { zone_id: "zone1", relay_channel: 1, name: "Zone", area_sqft: 100, location: "" };
      vi.mocked(dynamo.getZone).mockResolvedValue(zone as any);

      const inputs = [
        { zone_id: "zone1", gallons: -10 },
        { zone_id: "zone1", gallons: -0.1 },
      ];

      for (const input of inputs) {
        const result = JSON.parse(await executeTool(mockUserSub, "set_weekly_target", input));
        expect(result.error).toContain("non-negative");
        expect(vi.mocked(dynamo.putBudget)).not.toHaveBeenCalled();
      }
    });

    it("rejects unknown zone", async () => {
      vi.mocked(dynamo.getZone).mockResolvedValue(null);

      const input = { zone_id: "nonexistent", gallons: 50 };
      const result = JSON.parse(await executeTool(mockUserSub, "set_weekly_target", input));

      expect(result.error).toContain("not found");
    });
  });

  describe("all_off", () => {
    it("stops all active and pending zones and sweeps all relays", async () => {
      const zone1 = { zone_id: "zone1", relay_channel: 1, name: "Zone 1", area_sqft: 100, location: "" };
      const zone2 = { zone_id: "zone2", relay_channel: 2, name: "Zone 2", area_sqft: 100, location: "" };

      const activeSchedule = {
        zone_id: "zone1",
        relay_channel: 1,
        scheduled_start: "2026-08-20T10:00:00Z",
        scheduled_runtime_min: 30,
        scheduled_end: "2026-08-20T10:30:00Z",
        trigger_reason: "manual",
        status: "ACTIVE" as const,
      };
      const pendingSchedule = {
        zone_id: "zone2",
        relay_channel: 2,
        scheduled_start: "2026-08-20T10:30:00Z",
        scheduled_runtime_min: 30,
        scheduled_end: "2026-08-20T11:00:00Z",
        trigger_reason: "scheduled",
        status: "PENDING" as const,
      };

      vi.mocked(dynamo.getSchedules).mockResolvedValue([activeSchedule, pendingSchedule] as any);
      vi.mocked(dynamo.getZone).mockImplementation((sub, zoneId) => {
        if (zoneId === "zone1") return Promise.resolve(zone1 as any);
        if (zoneId === "zone2") return Promise.resolve(zone2 as any);
        return Promise.resolve(null);
      });
      vi.mocked(mqtt.commandRelay).mockResolvedValue(undefined);
      vi.mocked(dynamo.transitionScheduleStatus).mockResolvedValue(true);

      const result = JSON.parse(await executeTool(mockUserSub, "all_off", {}));

      expect(result.success).toBe(true);
      expect(result.stopped_zones).toContain("Zone 1");
      expect(result.stopped_zones).toContain("Zone 2");
      expect(result.relays_swept).toBe(16);

      // Verify commandRelay was called for all 16 channels
      for (let i = 1; i <= 16; i++) {
        expect(vi.mocked(mqtt.commandRelay)).toHaveBeenCalledWith(i, false);
      }

      // Verify schedules were transitioned
      expect(vi.mocked(dynamo.transitionScheduleStatus)).toHaveBeenCalledTimes(2);
    });

    it("handles empty zone list", async () => {
      vi.mocked(dynamo.getSchedules).mockResolvedValue([]);
      vi.mocked(mqtt.commandRelay).mockResolvedValue(undefined);

      const result = JSON.parse(await executeTool(mockUserSub, "all_off", {}));

      expect(result.success).toBe(true);
      expect(result.stopped_zones).toHaveLength(0);
      expect(result.relays_swept).toBe(16);
    });
  });

  describe("get_device_status", () => {
    it("returns board status, wifi, and firmware info", async () => {
      const boardStatus = { state: "online", since: "2026-08-20T08:00:00Z" };
      const wifiStatus = { ssid: "MyNetwork", ip: "192.168.1.100" };
      const firmwareState = { updating: false };

      vi.mocked(mqtt.getBoardStatus).mockResolvedValue(boardStatus as any);
      vi.mocked(mqtt.getRetainedJson).mockImplementation((topic) => {
        if (topic === "irrigation-controller/wifi/status") return Promise.resolve(wifiStatus as any);
        if (topic === "irrigation-controller/update/firmware_update/state") return Promise.resolve(firmwareState as any);
        return Promise.resolve(null);
      });

      const result = JSON.parse(await executeTool(mockUserSub, "get_device_status", {}));

      expect(result.board).toEqual(boardStatus);
      expect(result.wifi).toEqual(wifiStatus);
      expect(result.firmware).toEqual(firmwareState);
    });
  });

  describe("get_relay_states", () => {
    it("returns relay states map", async () => {
      const states = {
        1: "OFF",
        2: "ON",
        3: "OFF",
      };

      vi.mocked(mqtt.getAllRelayStates).mockResolvedValue(states as any);

      const result = JSON.parse(await executeTool(mockUserSub, "get_relay_states", {}));

      expect(result.states).toEqual(states);
      expect(result.note).toContain("Channels map");
    });
  });

  describe("wifi_scan", () => {
    it("polls for scan results and returns networks", async () => {
      const networks = [
        { ssid: "Network1", rssi: -50, secure: true },
        { ssid: "Network2", rssi: -70, secure: false },
      ];

      let callCount = 0;
      vi.mocked(mqtt.getRetainedJson).mockImplementation(async (topic) => {
        if (topic === "irrigation-controller/wifi/networks") {
          callCount++;
          // Return networks on second call
          return Promise.resolve(callCount >= 2 ? networks : null);
        }
        return null;
      });
      vi.mocked(mqtt.publishRaw).mockResolvedValue(undefined as any);

      const result = JSON.parse(await executeTool(mockUserSub, "wifi_scan", {}));

      expect(result.success).toBe(true);
      expect(result.networks).toEqual(networks);
    }, 15000);

    it("times out if no networks appear", async () => {
      vi.mocked(mqtt.getRetainedJson).mockResolvedValue(null as any);
      vi.mocked(mqtt.publishRaw).mockResolvedValue(undefined as any);

      const result = JSON.parse(await executeTool(mockUserSub, "wifi_scan", {}));

      expect(result.error).toContain("timed out");
    }, 15000);
  });

  describe("configure_wifi", () => {
    it("validates SSID and password", async () => {
      vi.mocked(mqtt.publishRaw).mockResolvedValue(undefined as any);

      // Test empty SSID
      let result = JSON.parse(await executeTool(mockUserSub, "configure_wifi", { ssid: "", password: "pass" }));
      expect(result.error).toContain("SSID");

      // Test SSID too long
      result = JSON.parse(await executeTool(mockUserSub, "configure_wifi", { ssid: "a".repeat(33), password: "pass" }));
      expect(result.error).toContain("SSID");

      // Test password too long
      result = JSON.parse(await executeTool(mockUserSub, "configure_wifi", { ssid: "MyNetwork", password: "p".repeat(64) }));
      expect(result.error).toContain("Password");

      expect(vi.mocked(mqtt.publishRaw)).not.toHaveBeenCalled();
    });

    it("publishes WiFi configuration", async () => {
      vi.mocked(mqtt.publishRaw).mockResolvedValue(undefined as any);

      const input = { ssid: "MyNetwork", password: "MyPassword" };
      const result = JSON.parse(await executeTool(mockUserSub, "configure_wifi", input));

      expect(result.success).toBe(true);
      expect(vi.mocked(mqtt.publishRaw)).toHaveBeenCalledWith(
        "irrigation-controller/wifi/set",
        expect.stringContaining("MyNetwork")
      );
    });
  });
});

// Helper function to get valid create_zone input
function getValidCreateInput(): Record<string, unknown> {
  return {
    name: "Test Zone",
    relay_channel: 1,
    area_sqft: 100,
    zone_type: "cool-season-turf",
    irrigation_method: "spray",
  };
}
