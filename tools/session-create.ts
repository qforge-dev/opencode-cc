import { tool } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import { SessionRegistry } from "../session-registry.ts";
import { SessionWorktreeManager } from "../worktrees/session-worktree-manager.ts";

type ToolDefinition = ReturnType<typeof tool>;

export function createSessionCreateTool(
  client: OpencodeClient,
  registry: SessionRegistry,
  worktreeManager: SessionWorktreeManager,
): ToolDefinition {
  return tool({
    description: "Create a new child session and register it to the current orchestrator session.",
    args: {
      title: tool.schema
        .string()
        .min(1)
        .describe("Short title describing what the child session will work on"),
    },
    async execute(args, context) {
      const originalDirectory = context.directory;
      const workspace = await worktreeManager.createChildSessionWorkspace({
        sessionID: context.sessionID,
        title: args.title,
        directory: context.directory,
        worktree: context.worktree,
        abort: context.abort,
      });

      const result = await client.session.create({
        parentID: context.sessionID,
        title: args.title,
        directory: workspace.directory,
      });

      if (result.error || !result.data) {
        if (workspace.directory !== originalDirectory) {
          await worktreeManager.cleanupWorkspace(workspace.directory);
        }
        return JSON.stringify({
          status: "error",
          error: result.error ? String(result.error) : "Unknown error",
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
