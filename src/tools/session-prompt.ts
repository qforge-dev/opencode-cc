import { tool } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import { rewritePromptPathsForChildWorktree } from "../utils/path-rewriter";
import { SessionRegistry } from "../../session-registry";

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
        .describe("Agent name to use in the child session, or null to use default"),
    },
    async execute(args, context) {
      if (registry.isNestedOrchestrator(context.sessionID)) {
        return JSON.stringify({
          status: "error",
          sessionID: args.sessionID,
          error:
            "Nested orchestrators are not supported. Use session_prompt from the root orchestrator session.",
        });
      }

      const childWorkspaceDirectory = registry.getChildWorkspaceDirectory(
        args.sessionID
      );
      const orchestratorDirectory = registry.getOrchestratorDirectory(
        args.sessionID
      );

      const agent = args.agent === null ? undefined : args.agent;

      const preparedPrompt = preparePromptForChildSession({
        prompt: args.prompt,
        orchestratorDirectory,
        childWorkspaceDirectory,
      });

      const result = await client.session.promptAsync({
        sessionID: args.sessionID,
        directory:
          childWorkspaceDirectory === null
            ? undefined
            : childWorkspaceDirectory,
        agent,
        parts: [
          {
            type: "text",
            text: preparedPrompt.text,
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
        pathRewrite: {
          rewrittenCount: preparedPrompt.rewrittenCount,
          error: preparedPrompt.error,
        },
      });
    },
  });
}

function preparePromptForChildSession(input: {
  prompt: string;
  orchestratorDirectory: string | null;
  childWorkspaceDirectory: string | null;
}): { text: string; rewrittenCount: number; error: string | null } {
  if (input.orchestratorDirectory === null) {
    return { text: input.prompt, rewrittenCount: 0, error: null };
  }

  if (input.childWorkspaceDirectory === null) {
    return { text: input.prompt, rewrittenCount: 0, error: null };
  }

  try {
    const result = rewritePromptPathsForChildWorktree({
      text: input.prompt,
      orchestratorDirectory: input.orchestratorDirectory,
      childWorkspaceDirectory: input.childWorkspaceDirectory,
    });

    return {
      text: result.text,
      rewrittenCount: result.rewrittenCount,
      error: result.errors.length ? truncateText(result.errors.join("\n"), 500) : null,
    };
  } catch (error) {
    return {
      text: input.prompt,
      rewrittenCount: 0,
      error: truncateText(String(error), 500),
    };
  }
}

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 3) return trimmed.slice(0, Math.max(0, maxChars));
  return trimmed.slice(0, Math.max(0, maxChars - 3)) + "...";
}
