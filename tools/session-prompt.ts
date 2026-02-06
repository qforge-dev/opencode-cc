import { tool } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk";

type ToolDefinition = ReturnType<typeof tool>;

export function createSessionPromptTool(client: OpencodeClient): ToolDefinition {
  return tool({
    description:
      "Send a prompt to a child session asynchronously. Returns immediately; results arrive later as a synthetic message in the orchestrator session.",
    args: {
      sessionID: tool.schema.string().min(1).describe("Child session ID to prompt"),
      prompt: tool.schema.string().min(1).describe("Prompt text to send to the child session"),
      agent: tool.schema
        .string()
        .min(1)
        .nullable()
        .describe("Agent name to use in the child session, or null to use default"),
    },
    async execute(args) {
      const result = await client.session.promptAsync({
        path: { id: args.sessionID },
        body: {
          agent: args.agent ?? undefined,
          parts: [{
            type: "text",
            text: args.prompt,
          }],
        },
      });

      if (result.error) {
        return JSON.stringify({
          status: "error",
          sessionID: args.sessionID,
          error: String(result.error),
        });
      }

      return JSON.stringify({
        status: "prompt_sent",
        sessionID: args.sessionID,
      });
    },
  });
}
