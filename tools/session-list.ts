import { tool } from "@opencode-ai/plugin";

import { SessionRegistry } from "../session-registry";

type ToolDefinition = ReturnType<typeof tool>;

export function createSessionListTool(
  registry: SessionRegistry
): ToolDefinition {
  return tool({
    description:
      "List child sessions created by the current orchestrator session.",
    args: {},
    async execute(_args, context) {
      const children = registry
        .listChildSessions(context.sessionID)
        .map((child) => ({
          ...child,
          lastActivityAt: registry.computeLastActivityAt(child.childSessionID),
        }));
      return JSON.stringify({
        status: "ok",
        orchestratorSessionID: context.sessionID,
        count: children.length,
        children,
      });
    },
  });
}
