import type { Plugin } from "@opencode-ai/plugin";
import { createOpencodeClient as createV2Client } from "@opencode-ai/sdk/v2";

import { agent as orchestratorAgent } from "./agents/orchestrator.ts";
import { handleStableIdle } from "./child-session-idle-handler.ts";
import { ChildSessionErrorForwarder } from "./child-session-error-forwarder.ts";
import { SessionRegistry } from "./session-registry.ts";
import { PermissionForwardingStore } from "./permission-forwarding-store.ts";
import { createSessionCreateTool } from "./tools/session-create.ts";
import { createSessionListTool } from "./tools/session-list.ts";
import { createSessionPromptTool } from "./tools/session-prompt.ts";
import { createSessionStatusTool } from "./tools/session-status.ts";
import { SessionWorktreeManager } from "./worktrees/session-worktree-manager.ts";

const OpencodeCC: Plugin = async (input) => {
  const client = createV2Client({
    baseUrl: input.serverUrl.toString(),
    directory: input.directory,
    fetch: resolveFetchFromPluginClient(input.client),
  });

  const orchestratorDirectory = input.directory;

  const registry = new SessionRegistry();
  const permissionStore = new PermissionForwardingStore();
  const pendingIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const worktreeManager = new SessionWorktreeManager(client);
  const errorForwarder = new ChildSessionErrorForwarder({
    client,
    registry,
    defaultOrchestratorDirectory: orchestratorDirectory,
  });

  const sessionCreateTool = createSessionCreateTool(
    client,
    registry,
    worktreeManager
  );
  const sessionListTool = createSessionListTool(registry);
  const sessionPromptTool = createSessionPromptTool(client, registry);
  const sessionStatusTool = createSessionStatusTool(client, registry);

  return {
    config: async (config) => {
      config.agent = config.agent || {};
      config.agent["orchestrator"] = orchestratorAgent;
    },
    event: async ({ event }) => {
      if (event.type === "permission.updated") {
        permissionStore.capturePermission(event.properties);
        return;
      }

      if (event.type === "permission.replied") {
        const permission = permissionStore.getPermission(
          event.properties.permissionID
        );
        if (permission) {
          const orchestratorSessionID =
            registry.getOrchestratorSessionID(permission.sessionID) ??
            permission.sessionID;
          permissionStore.captureReply(
            orchestratorSessionID,
            permission,
            event.properties.response
          );
        }
        return;
      }

      if (event.type === "session.status") {
        if (event.properties.status.type !== "busy") return;
        const childSessionID = event.properties.sessionID;
        const timer = pendingIdleTimers.get(childSessionID);
        if (!timer) return;
        clearTimeout(timer);
        pendingIdleTimers.delete(childSessionID);
        return;
      }

      if (event.type === "session.error") {
        const childSessionID = event.properties.sessionID;
        if (!childSessionID) return;
        await errorForwarder.handleSessionError({
          childSessionID,
          error: event.properties.error,
        });
        return;
      }

      if (event.type !== "session.idle") return;

      const childSessionID = event.properties.sessionID;
      const orchestratorSessionID =
        registry.getOrchestratorSessionID(childSessionID);
      if (!orchestratorSessionID) return;
      if (!registry.hasPendingForwardRequests(childSessionID)) return;

      const existingTimer = pendingIdleTimers.get(childSessionID);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        pendingIdleTimers.delete(childSessionID);

        const childOrchestratorDirectory =
          registry.getOrchestratorDirectory(childSessionID) ?? orchestratorDirectory;

        void handleStableIdle({
          client,
          registry,
          childSessionID,
          orchestratorSessionID,
          orchestratorDirectory: childOrchestratorDirectory,
        });
      }, 5000);

      pendingIdleTimers.set(childSessionID, timer);
    },
    "permission.ask": async (permission, output) => {
      const orchestratorSessionID = registry.getOrchestratorSessionID(
        permission.sessionID
      );
      if (!orchestratorSessionID) return;

      const forwardedStatus = permissionStore.getForwardedStatus(
        orchestratorSessionID,
        permission
      );
      if (forwardedStatus) output.status = forwardedStatus;
    },
    tool: {
      session_create: sessionCreateTool,
      session_list: sessionListTool,
      session_prompt: sessionPromptTool,
      session_status: sessionStatusTool,
    },
  };
};

export default OpencodeCC;

function resolveFetchFromPluginClient(
  client: unknown
): typeof fetch | undefined {
  const anyClient = client as any;
  const underscoreFetch = anyClient?._client?.fetch;
  if (typeof underscoreFetch === "function")
    return underscoreFetch.bind(anyClient._client);

  const directFetch = anyClient?.client?.fetch;
  if (typeof directFetch === "function")
    return directFetch.bind(anyClient.client);

  return undefined;
}
