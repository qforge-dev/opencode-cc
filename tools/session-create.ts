import { tool } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk";

import { SessionRegistry } from "../session-registry.ts";

type ToolDefinition = ReturnType<typeof tool>;

export function createSessionCreateTool(client: OpencodeClient, registry: SessionRegistry): ToolDefinition {
  return tool({
    description: "Create a new child session and register it to the current orchestrator session.",
    args: {
      title: tool.schema
        .string()
        .min(1)
        .describe("Short title describing what the child session will work on"),
    },
    async execute(args, context) {
      const result = await client.session.create({
        body: {
          title: args.title,
        },
      });

      if (result.error || !result.data) {
        return JSON.stringify({
          status: "error",
          error: result.error ? String(result.error) : "Unknown error",
        });
      }

      registry.registerChildSession(result.data.id, context.sessionID);

      return JSON.stringify({
        status: "created",
        sessionID: result.data.id,
        title: result.data.title,
      });
    },
  });
}
