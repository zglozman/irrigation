// POST /api/chat
// SSE streaming chat endpoint with manual tool use loop
// Client POSTs {messages: [...prior turns...]}, we stream back data: {...} events

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getBedrockClient, CHAT_MODEL } from "@/lib/chat/bedrock";
import { TOOLS, executeTool } from "@/lib/chat/tools";

const SYSTEM_PROMPT = `You are Sprout, the garden's caretaker AI — friendly, concise, a little plant-punny but never annoying.

You understand this irrigation system:
- 16-relay controller for zone management
- Weekly gallon budgets offset by rainfall
- 4-8am watering window preferred
- Maximum 55-minute zone runs
- Real-time weather forecast integration

You have full operational control and can:
- Create, update, and delete irrigation zones
- Set weekly water targets (in gallons)
- Run/stop individual zones and emergency stop all zones
- Direct relay control (for testing pumps/valves)
- Device status, WiFi scanning, and backup WiFi setup
- View activity history, forecasts, and rainfall data
- Configure Weather Underground personal weather stations for real rainfall measurement
- Invite new users
- Re-evaluate schedules against current weather

BEHAVIOR RULES:
- Confirm before: deleting zones, inviting users, configuring WiFi, or starting runs over 30 minutes
- Prefer run_zone over set_relay for watering (it records history, budgets, and logs)
- After any change, restate what changed in plain garden language
- Never invent data — fetch it first with your tools
- Explain scheduling decisions using tool data before speculating

Be conversational but concise. Use the tools actively — don't guess when you can ask the system for real data.`;

export async function POST(request: NextRequest) {
  const user = await requireUser();
  const { messages } = (await request.json()) as { messages: any[] };

  const encoder = new TextEncoder();

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const send = (data: Record<string, unknown>) => {
            const json = JSON.stringify(data);
            controller.enqueue(encoder.encode(`data: ${json}\n\n`));
          };

          const client = getBedrockClient();
          let conversationMessages = [...messages];

          for (let i = 0; i < 8; i++) {
            const response = await client.messages.create({
              model: CHAT_MODEL,
              max_tokens: 8000,
              system: SYSTEM_PROMPT,
              tools: TOOLS as any,
              messages: conversationMessages,
            });

            // Stream text deltas
            for (const content of response.content) {
              if (content.type === "text") {
                send({ type: "text", delta: content.text });
              }
            }

            // Check stop reason
            if (response.stop_reason === "end_turn" || response.stop_reason === "stop_sequence") {
              // Conversation complete
              break;
            }

            if (response.stop_reason !== "tool_use") {
              // No more tool calls
              break;
            }

            // Process tool uses
            const toolUses = response.content.filter((c) => c.type === "tool_use");
            if (toolUses.length === 0) {
              // No tools to call, break
              break;
            }

            // Add assistant response to conversation
            conversationMessages.push({
              role: "assistant",
              content: response.content,
            });

            // Execute all tools and collect results
            const toolResults = [];
            for (const toolUse of toolUses) {
              if (toolUse.type !== "tool_use") continue;

              const friendlyLabel = friendlyLabelForTool(
                toolUse.name,
                (toolUse.input as Record<string, unknown>) || {}
              );
              send({ type: "tool", name: toolUse.name, label: friendlyLabel });

              try {
                const result = await executeTool(user.sub, toolUse.name, toolUse.input as Record<string, unknown>);
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: result,
                });
              } catch (error) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
                  is_error: true,
                });
              }
            }

            // Add all tool results in a single user message (important!)
            conversationMessages.push({
              role: "user",
              content: toolResults,
            });
          }

          send({ type: "done" });
          controller.close();
        } catch (error) {
          console.error("[Chat] Error:", error);
          const encoder = new TextEncoder();
          const json = JSON.stringify({
            type: "error",
            message: error instanceof Error ? error.message : "Unknown error",
          });
          controller.enqueue(encoder.encode(`data: ${json}\n\n`));
          // The stream contract is that a done event always terminates it.
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    }
  );
}

function friendlyLabelForTool(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case "run_zone":
      return `💧 Opening valve for ${toolInput.zone_id}…`;
    case "stop_zone":
      return `🛑 Stopping zone ${toolInput.zone_id}…`;
    case "get_forecast":
      return `🌦️ Checking the forecast…`;
    case "get_weather_comparison":
      return `📊 Comparing forecast to actual…`;
    case "get_rainfall_this_week":
      return `🌧️ Checking this week's rainfall…`;
    case "get_history":
      return `📜 Reading the logbook…`;
    case "list_zones":
      return `🌱 Gathering zone info…`;
    case "get_zone_details":
      return `🔍 Looking up zone details…`;
    case "reevaluate_now":
      return `🔄 Re-evaluating schedule…`;
    case "create_zone":
      return `🌿 Creating zone "${toolInput.name}"…`;
    case "update_zone":
      return `✏️ Updating zone ${toolInput.zone_id}…`;
    case "delete_zone":
      return `🗑️ Deleting zone ${toolInput.zone_id}…`;
    case "get_device_status":
      return `📡 Checking controller status…`;
    case "get_relay_states":
      return `🔌 Reading relay states…`;
    case "set_relay":
      return `⚡ Toggling relay ${toolInput.channel}…`;
    case "wifi_scan":
      return `📡 Scanning for WiFi networks…`;
    case "configure_wifi":
      return `📶 Setting up WiFi…`;
    case "get_activity":
      return `📊 Fetching activity…`;
    case "set_weekly_target":
      return `🎯 Setting weekly target for ${toolInput.zone_id}…`;
    case "all_off":
      return `🚨 Emergency stop — all zones off…`;
    case "invite_user":
      return `👤 Inviting ${toolInput.email}…`;
    default:
      return `⚙️ ${toolName}…`;
  }
}
