import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  IoTDataPlaneClient,
  GetRetainedMessageCommand,
} from "@aws-sdk/client-iot-data-plane";
import { IoTClient, DescribeEndpointCommand } from "@aws-sdk/client-iot";
import { getBoardStatus } from "@/lib/iot-mqtt";

describe("iot-mqtt", () => {
  describe("getBoardStatus", () => {
    let iotClientMock: any;
    let iotDataMock: any;

    beforeEach(() => {
      iotClientMock = mockClient(IoTClient);
      iotDataMock = mockClient(IoTDataPlaneClient);

      // Mock DescribeEndpoint (needed for client initialization)
      iotClientMock.on(DescribeEndpointCommand).resolves({
        endpointAddress: "test-endpoint.iot.us-east-1.amazonaws.com",
      });
    });

    it("returns 'online' when retained message is plain 'online'", async () => {
      iotDataMock.on(GetRetainedMessageCommand).resolves({
        payload: new TextEncoder().encode("online"),
        lastModifiedTime: new Date("2026-08-20T08:00:00Z").getTime(),
      });

      const result = await getBoardStatus();

      expect(result.state).toBe("online");
      expect(result.since).toBeTruthy();
      expect(result.since).toContain("2026-08-20");
    });

    it("returns 'offline' when retained message is plain 'offline'", async () => {
      // regression: ESPHome sends plain "online"/"offline", not JSON
      iotDataMock.on(GetRetainedMessageCommand).resolves({
        payload: new TextEncoder().encode("offline"),
        lastModifiedTime: new Date("2026-08-20T09:00:00Z").getTime(),
      });

      const result = await getBoardStatus();

      expect(result.state).toBe("offline");
      expect(result.since).toBeTruthy();
    });

    it("returns 'unknown' for garbage payload", async () => {
      iotDataMock.on(GetRetainedMessageCommand).resolves({
        payload: new TextEncoder().encode("garbage_text"),
        lastModifiedTime: new Date("2026-08-20T08:00:00Z").getTime(),
      });

      const result = await getBoardStatus();

      expect(result.state).toBe("unknown");
    });

    it("returns 'unknown' when no payload", async () => {
      iotDataMock.on(GetRetainedMessageCommand).resolves({
        payload: undefined,
        lastModifiedTime: new Date("2026-08-20T08:00:00Z").getTime(),
      });

      const result = await getBoardStatus();

      expect(result.state).toBe("unknown");
      expect(result.since).toBeTruthy(); // Still has timestamp
    });

    it("returns null since for missing lastModifiedTime", async () => {
      iotDataMock.on(GetRetainedMessageCommand).resolves({
        payload: new TextEncoder().encode("online"),
        lastModifiedTime: undefined,
      });

      const result = await getBoardStatus();

      expect(result.state).toBe("online");
      expect(result.since).toBeNull();
    });

    it("returns 'unknown' with null since on ResourceNotFoundException", async () => {
      const error = new Error("ResourceNotFoundException");
      (error as any).name = "ResourceNotFoundException";
      iotDataMock.on(GetRetainedMessageCommand).rejects(error);

      const result = await getBoardStatus();

      expect(result.state).toBe("unknown");
      expect(result.since).toBeNull();
    });

    it("returns 'unknown' with null since on general error", async () => {
      iotDataMock.on(GetRetainedMessageCommand).rejects(new Error("Connection failed"));

      const result = await getBoardStatus();

      expect(result.state).toBe("unknown");
      expect(result.since).toBeNull();
    });

    it("converts lastModifiedTime (epoch ms) to ISO timestamp correctly", async () => {
      const knownTime = new Date("2026-08-20T08:30:45.123Z").getTime();
      iotDataMock.on(GetRetainedMessageCommand).resolves({
        payload: new TextEncoder().encode("online"),
        lastModifiedTime: knownTime,
      });

      const result = await getBoardStatus();

      expect(result.since).toContain("2026-08-20T08:30:45");
    });

    it("handles whitespace around payload", async () => {
      iotDataMock.on(GetRetainedMessageCommand).resolves({
        payload: new TextEncoder().encode("  online  \n"),
        lastModifiedTime: new Date("2026-08-20T08:00:00Z").getTime(),
      });

      const result = await getBoardStatus();

      expect(result.state).toBe("online");
    });

    it("decodes Uint8Array payload correctly", async () => {
      const encoder = new TextEncoder();
      const payload = encoder.encode("offline");

      iotDataMock.on(GetRetainedMessageCommand).resolves({
        payload,
        lastModifiedTime: new Date("2026-08-20T08:00:00Z").getTime(),
      });

      const result = await getBoardStatus();

      expect(result.state).toBe("offline");
    });

    it("integration: full flow with online status and timestamp", async () => {
      const testTime = new Date("2026-08-22T14:00:00Z");
      iotDataMock.on(GetRetainedMessageCommand).resolves({
        payload: new TextEncoder().encode("online"),
        lastModifiedTime: testTime.getTime(),
      });

      const result = await getBoardStatus();

      expect(result).toEqual({
        state: "online",
        since: testTime.toISOString(),
      });
    });

    it("case sensitive: 'Online' is not recognized", async () => {
      iotDataMock.on(GetRetainedMessageCommand).resolves({
        payload: new TextEncoder().encode("Online"),
        lastModifiedTime: new Date("2026-08-20T08:00:00Z").getTime(),
      });

      const result = await getBoardStatus();

      expect(result.state).toBe("unknown");
    });

    it("empty payload treated as unknown", async () => {
      iotDataMock.on(GetRetainedMessageCommand).resolves({
        payload: new TextEncoder().encode(""),
        lastModifiedTime: new Date("2026-08-20T08:00:00Z").getTime(),
      });

      const result = await getBoardStatus();

      expect(result.state).toBe("unknown");
    });
  });
});
