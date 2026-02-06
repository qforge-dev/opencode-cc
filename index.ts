import type { Plugin } from "@opencode-ai/plugin";

import { agent as orchestratorAgent } from "./agents/orchestrator.ts";
import { SessionRegistry } from "./session-registry.ts";
import { PermissionForwardingStore } from "./permission-forwarding-store.ts";
import { createSessionCreateTool } from "./tools/session-create.ts";
import { createSessionPromptTool } from "./tools/session-prompt.ts";

const OpencodeCC: Plugin = async (input) => {
  const registry = new SessionRegistry();
  const permissionStore = new PermissionForwardingStore();
  const pendingIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const sessionCreateTool = createSessionCreateTool(input.client, registry);
  const sessionPromptTool = createSessionPromptTool(input.client);

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

        await input.client.session.prompt({
          path: { id: orchestratorSessionID },
          body: {
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
          },
        });
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
          client: input.client,
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
      session_prompt: sessionPromptTool,
    },
  };
};

export default OpencodeCC;

async function handleStableIdle(input: {
  client: Parameters<Plugin>[0]["client"];
  registry: SessionRegistry;
  childSessionID: string;
  orchestratorSessionID: string;
}): Promise<void> {
  const statusResult = await input.client.session.status();
  if (statusResult.error || !statusResult.data) return;
  const status = statusResult.data?.[input.childSessionID];
  if (status?.type === "busy") return;

  const messagesResult = await input.client.session.messages({
    path: { id: input.childSessionID },
  });

  if (messagesResult.error) return;

  if (!messagesResult.data) {
    await input.client.session.prompt({
      path: { id: input.orchestratorSessionID },
      body: {
        agent: "orchestrator",
        parts: [
          {
            type: "text",
            text: `[Child session ${input.childSessionID} completed]\n\nNo messages were returned.`,
            synthetic: true,
            metadata: {
              childSessionID: input.childSessionID,
              status: "completed",
            },
          },
        ],
      },
    });
    return;
  }

  const latest = findLatestAssistantMessage(messagesResult.data);
  if (!latest) return;

  const alreadyDelivered = input.registry.getLastDeliveredAssistantMessageID(input.childSessionID);
  if (alreadyDelivered === latest.info.id) return;

  const responseText = extractTextFromParts(latest.parts);
  const text = responseText.trim().length
    ? responseText
    : "(no text output)";

  await input.client.session.prompt({
    path: { id: input.orchestratorSessionID },
    body: {
      agent: "orchestrator",
      parts: [
        {
          type: "text",
          text: `[Child session ${input.childSessionID} completed]\n\n${text}`,
          synthetic: true,
          metadata: {
            childSessionID: input.childSessionID,
            status: "completed",
            assistantMessageID: latest.info.id,
          },
        },
      ],
    },
  });

  input.registry.setLastDeliveredAssistantMessageID(input.childSessionID, latest.info.id);
}

function findLatestAssistantMessage(
  messages: Array<{ info: { role: string; id: string }; parts: Array<{ type: string; text?: string; ignored?: boolean }> }>,
): { info: { role: string; id: string }; parts: Array<{ type: string; text?: string; ignored?: boolean }> } | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    if (message.info.role === "assistant") return message;
  }
  return null;
}

function extractTextFromParts(parts: Array<{ type: string; text?: string; ignored?: boolean }>): string {
  return parts
    .filter((part) => part.type === "text" && !part.ignored)
    .map((part) => part.text ?? "")
    .join("\n");
}
