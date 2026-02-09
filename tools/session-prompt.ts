import { tool } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import { SessionRegistry } from "../session-registry";

type ToolDefinition = ReturnType<typeof tool>;

export function createSessionPromptTool(
  client: OpencodeClient,
  registry: SessionRegistry
): ToolDefinition {
  return tool({
    description:
      "Send a prompt to a child session asynchronously. Returns immediately; results arrive later as a synthetic message in the orchestrator session.",
    args: {
      sessionID: tool.schema
        .string()
        .min(1)
        .describe("Child session ID to prompt"),
      prompt: tool.schema
        .string()
        .min(1)
        .describe("Prompt text to send to the child session"),
      agent: tool.schema
        .string()
        .min(1)
        .nullable()
        .describe(
          "Agent name to use in the child session, or null to use default"
      ),
    },
    async execute(args, context) {
      if (registry.isNestedOrchestrator(context.sessionID)) {
        return JSON.stringify({
          status: "error",
          sessionID: args.sessionID,
          error: "Nested orchestrators are not supported. Use session_prompt from the root orchestrator session.",
        });
      }

      const directory = registry.getChildWorkspaceDirectory(args.sessionID);

      const agent = args.agent === null ? undefined : args.agent;

      const result = await client.session.promptAsync({
        sessionID: args.sessionID,
        directory: directory === null ? undefined : directory,
        agent,
        parts: [
          {
            type: "text",
            text: args.prompt,
          },
        ],
      });

      if (result.error) {
        return JSON.stringify({
          status: "error",
          sessionID: args.sessionID,
          error: truncateText(String(result.error), 2000),
        });
      }

      if (registry.isTrackedChildSession(args.sessionID)) {
        registry.markPromptSent(args.sessionID, Date.now(), args.agent);
      }

      return JSON.stringify({
        status: "prompt_sent",
        sessionID: args.sessionID,
        agent: args.agent,
      });
    },
  });
}

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 3) return trimmed.slice(0, Math.max(0, maxChars));
  return trimmed.slice(0, Math.max(0, maxChars - 3)) + "...";
}
