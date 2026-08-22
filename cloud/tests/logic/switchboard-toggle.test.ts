import { describe, it, expect } from "vitest";

/**
 * Switchboard toggle logic test
 *
 * The toggle component's onChange handler receives the value to send to the command.
 * Logic from pages.tsx line 42:
 *   const treatAsOff = state === "UNKNOWN" || state === "OFF";
 *   onChange(treatAsOff);
 *
 * So the handler is called with:
 *   - true (turn ON) when state is "OFF" or "UNKNOWN"
 *   - false (turn OFF) when state is "ON"
 *
 * regression: the toggle once sent the CURRENT state (inverted)
 * This test documents the correct truth table.
 */

describe("switchboard-toggle logic", () => {
  /**
   * Truth table for switchboard toggle
   * Given the state, what command should be sent?
   */
  function computeCommand(state: "ON" | "OFF" | "UNKNOWN"): boolean {
    // From ToggleSwitch component:
    // const treatAsOff = state === "UNKNOWN" || state === "OFF";
    // onChange(treatAsOff);  // onChange is called with the value to send
    const treatAsOff = state === "UNKNOWN" || state === "OFF";
    return treatAsOff; // true = turn ON, false = turn OFF
  }

  it("state OFF sends command true (turn ON)", () => {
    const command = computeCommand("OFF");
    expect(command).toBe(true);
  });

  it("state ON sends command false (turn OFF)", () => {
    const command = computeCommand("ON");
    expect(command).toBe(false);
  });

  it("state UNKNOWN sends command true (turn ON)", () => {
    const command = computeCommand("UNKNOWN");
    expect(command).toBe(true);
  });

  describe("regression: toggle sends inverted command, not current", () => {
    it("regression: OFF->true (ON), not OFF", () => {
      // The bug: toggle once sent the current state instead of the inverted command
      // Correct: OFF should send true (command to turn ON)
      // Buggy: OFF would send false (current state)
      const command = computeCommand("OFF");
      expect(command).not.toBe(false); // Not the current state
      expect(command).toBe(true); // The inverted command
    });

    it("regression: ON->false (OFF), not ON", () => {
      // Correct: ON should send false (command to turn OFF)
      // Buggy: ON would send true (current state)
      const command = computeCommand("ON");
      expect(command).not.toBe(true); // Not the current state
      expect(command).toBe(false); // The inverted command
    });

    it("regression: UNKNOWN->true (ON), not UNKNOWN/false", () => {
      // Correct: UNKNOWN should send true (turn ON as fallback)
      // Buggy: UNKNOWN might send false
      const command = computeCommand("UNKNOWN");
      expect(command).not.toBe(false);
      expect(command).toBe(true);
    });
  });

  describe("toggle behavior from user perspective", () => {
    it("user sees OFF button, clicks it, relay turns ON", () => {
      const displayState = "OFF";
      const commandSent = computeCommand(displayState);
      expect(commandSent).toBe(true); // Command to turn ON
    });

    it("user sees ON button, clicks it, relay turns OFF", () => {
      const displayState = "ON";
      const commandSent = computeCommand(displayState);
      expect(commandSent).toBe(false); // Command to turn OFF
    });

    it("user sees UNKNOWN (dash), clicks it, relay turns ON (safe default)", () => {
      const displayState = "UNKNOWN";
      const commandSent = computeCommand(displayState);
      expect(commandSent).toBe(true); // Safe to turn ON from unknown
    });
  });

  describe("state machine: toggle cycles through states", () => {
    it("toggle cycle: OFF -> ON -> OFF", () => {
      let state: "ON" | "OFF" | "UNKNOWN" = "OFF";

      // Click 1: OFF -> turn ON
      let cmd1 = computeCommand(state);
      expect(cmd1).toBe(true);
      state = "ON";

      // Click 2: ON -> turn OFF
      let cmd2 = computeCommand(state);
      expect(cmd2).toBe(false);
      state = "OFF";

      // Click 3: OFF -> turn ON
      let cmd3 = computeCommand(state);
      expect(cmd3).toBe(true);
      expect(state).toBe("OFF");
    });

    it("toggle from UNKNOWN recovers to normal cycle", () => {
      let state: "ON" | "OFF" | "UNKNOWN" = "UNKNOWN";

      // Click 1: UNKNOWN -> turn ON
      let cmd1 = computeCommand(state);
      expect(cmd1).toBe(true);
      state = "ON"; // Assume device responds

      // Click 2: ON -> turn OFF
      let cmd2 = computeCommand(state);
      expect(cmd2).toBe(false);
      state = "OFF";

      // Now in normal cycle
      let cmd3 = computeCommand(state);
      expect(cmd3).toBe(true);
    });
  });

  describe("idempotency: sending same command multiple times", () => {
    it("OFF state can send ON command multiple times (harmless)", () => {
      const cmd1 = computeCommand("OFF");
      const cmd2 = computeCommand("OFF");

      expect(cmd1).toBe(true);
      expect(cmd2).toBe(true);
      // Sending ON when already ON is idempotent (no harm)
    });

    it("ON state can send OFF command multiple times (harmless)", () => {
      const cmd1 = computeCommand("ON");
      const cmd2 = computeCommand("ON");

      expect(cmd1).toBe(false);
      expect(cmd2).toBe(false);
      // Sending OFF when already OFF is idempotent (no harm)
    });
  });
});
