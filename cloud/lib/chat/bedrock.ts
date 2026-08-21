// Bedrock client factory — the Mantle client signs requests with SigV4 and
// sends them to the Bedrock Messages endpoint (credentials from the SDK's
// default AWS chain, same as the rest of the app).
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { config } from "@/lib/config";

let bedrockClient: AnthropicBedrockMantle | null = null;

export function getBedrockClient(): AnthropicBedrockMantle {
  if (!bedrockClient) {
    bedrockClient = new AnthropicBedrockMantle({ awsRegion: config.aws.region });
  }
  return bedrockClient;
}

export const CHAT_MODEL = process.env.CHAT_MODEL || "us.anthropic.claude-opus-5";
