import { tool } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import { SessionRegistry } from "../session-registry";
import { SessionWorktreeManager } from "../worktrees/session-worktree-manager";

type ToolDefinition = ReturnType<typeof tool>;

export function createSessionCreateTool(
  client: OpencodeClient,
  registry: SessionRegistry,
  worktreeManager: SessionWorktreeManager
): ToolDefinition {
  return tool({
    description:
      "Create a new child session and register it to the current orchestrator session.",
    args: {
      title: tool.schema
        .string()
        .min(1)
        .describe("Short title describing what the child session will work on"),
    },
    async execute(args, context) {
      if (registry.isNestedOrchestrator(context.sessionID)) {
        return JSON.stringify({
          status: "error",
          error: "Nested orchestrators are not supported. Use session_create from the root orchestrator session.",
        });
      }

      const originalDirectory = context.directory;
      const workspace = await worktreeManager.createChildSessionWorkspace({
        sessionID: context.sessionID,
        title: args.title,
        directory: context.directory,
        worktree: context.worktree,
        abort: context.abort,
      });

      const result = await client.session.create({
        directory: workspace.directory,
        title: args.title,
      });

      if (result.error || !result.data) {
        if (workspace.directory !== originalDirectory) {
          await worktreeManager.cleanupWorkspace(workspace.directory);
        }
        return JSON.stringify({
          status: "error",
          error: result.error
            ? truncateText(String(result.error), 2000)
            : "Unknown error",
        });
      }

      registry.registerChildSession({
        childSessionID: result.data.id,
        orchestratorSessionID: context.sessionID,
        title: result.data.title,
        createdAt: Date.now(),
        workspaceDirectory: workspace.directory,
        workspaceBranch: workspace.branch,
      });

      return JSON.stringify({
        status: "created",
        sessionID: result.data.id,
        title: result.data.title,
        directory: workspace.directory,
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
