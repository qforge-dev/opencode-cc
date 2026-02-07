import type { Plugin } from "@opencode-ai/plugin";
import { createOpencodeClient as createV2Client } from "@opencode-ai/sdk/v2";

import { agent as orchestratorAgent } from "./agents/orchestrator.ts";
import { handleStableIdle } from "./child-session-idle-handler.ts";
import { buildExecutionPromptFromApprovedPlanWithUserAnswers } from "./plan-first-prompts.ts";
import { REPO_RULES_TEXT } from "./repo-rules.ts";
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
    fetch: resolveFetchFromPluginClient(input.client),
  });

  const registry = new SessionRegistry();
  const permissionStore = new PermissionForwardingStore();
  const pendingIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const worktreeManager = new SessionWorktreeManager(client);

  const sessionCreateTool = createSessionCreateTool(client, registry, worktreeManager);
  const sessionListTool = createSessionListTool(registry);
  const sessionPromptTool = createSessionPromptTool(client, registry);
  const sessionStatusTool = createSessionStatusTool(client, registry);

  return {
    config: async (config) => {
      config.agent = config.agent || {};
      config.agent["orchestrator"] = orchestratorAgent;
    },
    "chat.message": async (messageInput, output) => {
      const childSessionsAwaitingAnswers = registry.getChildSessionsAwaitingAnswers(messageInput.sessionID);
      if (childSessionsAwaitingAnswers.length === 0) return;

      const userText = extractTextFromParts(output.parts).trim();
      if (!userText.length) return;

      if (childSessionsAwaitingAnswers.length !== 1) {
        await client.session.prompt({
          sessionID: messageInput.sessionID,
          agent: "orchestrator",
          parts: [
            {
              type: "text",
              text:
                "[Questions need routing]\n\nMultiple child sessions are waiting for answers. Reply with which child session ID you are answering:\n\n" +
                childSessionsAwaitingAnswers.map((id) => `- ${id}`).join("\n"),
              synthetic: true,
              metadata: {
                status: "questions_routing",
                childSessionIDs: childSessionsAwaitingAnswers,
              },
            },
          ],
        });
        return;
      }

      const childSessionID = childSessionsAwaitingAnswers[0] ?? null;
      if (!childSessionID) return;

      const pendingExecution = registry.getPendingExecutionPrompt(childSessionID);
      const planText = registry.getPendingPlanText(childSessionID);
      if (!pendingExecution || !planText) return;

      const executionPrompt = buildExecutionPromptFromApprovedPlanWithUserAnswers({
        approvedPlan: planText,
        taskPrompt: pendingExecution.prompt,
        repoRules: REPO_RULES_TEXT,
        userAnswers: userText,
      });

      const directory = registry.getChildWorkspaceDirectory(childSessionID);

      const executionResult = await client.session.promptAsync({
        sessionID: childSessionID,
        directory: directory === null ? undefined : directory,
        agent: pendingExecution.agent ?? undefined,
        parts: [
          {
            type: "text",
            text: executionPrompt,
          },
        ],
      });

      if (executionResult.error) {
        await client.session.prompt({
          sessionID: messageInput.sessionID,
          agent: "orchestrator",
          parts: [
            {
              type: "text",
              text: `[Child session ${childSessionID} error]\n\nFailed to start execution after answers: ${String(executionResult.error)}`,
              synthetic: true,
              metadata: {
                childSessionID,
                status: "error",
              },
            },
          ],
        });

        registry.markError(
          childSessionID,
          Date.now(),
          truncateText(`Failed to start execution after answers: ${String(executionResult.error)}`, 400),
        );
        return;
      }

      registry.markPromptSent(childSessionID, Date.now());
      registry.markExecutionPromptSent(childSessionID);

      await client.session.prompt({
        sessionID: messageInput.sessionID,
        agent: "orchestrator",
        parts: [
          {
            type: "text",
            text: `[Child session ${childSessionID} executing]\n\nForwarded your answers and started execution.`,
            synthetic: true,
            metadata: {
              childSessionID,
              status: "executing",
            },
          },
        ],
      });
    },
    event: async ({ event }) => {
      if (event.type === "permission.updated") {
        permissionStore.capturePermission(event.properties);
        return;
      }

      if (event.type === "permission.replied") {
        const permission = permissionStore.getPermission(event.properties.permissionID);
        if (permission) {
          const orchestratorSessionID =
            registry.getOrchestratorSessionID(permission.sessionID) ?? permission.sessionID;
          permissionStore.captureReply(orchestratorSessionID, permission, event.properties.response);
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
        const orchestratorSessionID = registry.getOrchestratorSessionID(childSessionID);
        if (!orchestratorSessionID) return;

        const errorText = event.properties.error
          ? JSON.stringify(event.properties.error)
          : "Unknown error";

        await client.session.prompt({
          sessionID: orchestratorSessionID,
          agent: "orchestrator",
          parts: [
            {
              type: "text",
              text: `[Child session ${childSessionID} error]\n\n${errorText}`,
              synthetic: true,
              metadata: {
                childSessionID,
                status: "error",
              },
            },
          ],
        });

        registry.markError(childSessionID, Date.now(), truncateText(errorText, 400));
        return;
      }

      if (event.type !== "session.idle") return;

      const childSessionID = event.properties.sessionID;
      const orchestratorSessionID = registry.getOrchestratorSessionID(childSessionID);
      if (!orchestratorSessionID) return;

      const existingTimer = pendingIdleTimers.get(childSessionID);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        pendingIdleTimers.delete(childSessionID);
        void handleStableIdle({
          client,
          registry,
          childSessionID,
          orchestratorSessionID,
        });
      }, 5000);

      pendingIdleTimers.set(childSessionID, timer);
    },
    "permission.ask": async (permission, output) => {
      const orchestratorSessionID = registry.getOrchestratorSessionID(permission.sessionID);
      if (!orchestratorSessionID) return;

      const forwardedStatus = permissionStore.getForwardedStatus(orchestratorSessionID, permission);
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

function resolveFetchFromPluginClient(client: unknown): typeof fetch | undefined {
  const anyClient = client as any;
  const underscoreFetch = anyClient?._client?.fetch;
  if (typeof underscoreFetch === "function") return underscoreFetch.bind(anyClient._client);

  const directFetch = anyClient?.client?.fetch;
  if (typeof directFetch === "function") return directFetch.bind(anyClient.client);

  return undefined;
}

function extractTextFromParts(parts: Array<{ type: string; text?: string; ignored?: boolean }>): string {
  return parts
    .filter((part) => part.type === "text" && !part.ignored)
    .map((part) => part.text ?? "")
    .join("\n");
}

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 3) return trimmed.slice(0, Math.max(0, maxChars));
  return trimmed.slice(0, Math.max(0, maxChars - 3)) + "...";
}
