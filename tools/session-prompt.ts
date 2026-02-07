import { tool } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import { buildPlanningOnlyPrompt } from "../plan-first-prompts.ts";
import { REPO_RULES_TEXT } from "../repo-rules.ts";
import { SessionRegistry } from "../session-registry.ts";

type ToolDefinition = ReturnType<typeof tool>;

export function createSessionPromptTool(client: OpencodeClient, registry: SessionRegistry): ToolDefinition {
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
      const shouldPlanFirst = registry.shouldSendPlanningPrompt(args.sessionID);

      if (shouldPlanFirst) {
        registry.markPlanningPromptSent(args.sessionID, {
          prompt: args.prompt,
          agent: args.agent,
        });
      }

      const promptText = shouldPlanFirst
        ? buildPlanningOnlyPrompt({
          taskPrompt: args.prompt,
          repoRules: REPO_RULES_TEXT,
        })
        : args.prompt;

      const directory = registry.getChildWorkspaceDirectory(args.sessionID);

      const result = await client.session.promptAsync({
        sessionID: args.sessionID,
        directory: directory === null ? undefined : directory,
        agent: args.agent ?? undefined,
        parts: [
          {
            type: "text",
            text: promptText,
          },
        ],
      });

      if (result.error) {
        if (shouldPlanFirst) registry.resetPlanFirst(args.sessionID);
        return JSON.stringify({
          status: "error",
          sessionID: args.sessionID,
          error: String(result.error),
        });
      }

      if (registry.isTrackedChildSession(args.sessionID)) {
        registry.markPromptSent(args.sessionID, Date.now());
      }

      return JSON.stringify({
        status: "prompt_sent",
        sessionID: args.sessionID,
        planFirst: shouldPlanFirst,
      });
    },
  });
}
