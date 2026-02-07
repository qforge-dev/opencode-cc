import { tool } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import {
  type ChildSessionProgress,
  SessionRegistry,
} from "../session-registry";

type ToolDefinition = ReturnType<typeof tool>;

export function createSessionStatusTool(
  client: OpencodeClient,
  registry: SessionRegistry
): ToolDefinition {
  return tool({
    description:
      "Get status/progress for a specific child session created by this orchestrator session (includes timestamps and last output excerpt when available).",
    args: {
      sessionID: tool.schema.string().min(1).describe("Child session ID"),
      refresh: tool.schema
        .boolean()
        .nullable()
        .describe("If true, fetch latest child messages to update excerpt"),
    },
    async execute(args, context) {
      const orchestratorSessionID = registry.getOrchestratorSessionID(
        args.sessionID
      );
      if (orchestratorSessionID === null) {
        return JSON.stringify({
          status: "error",
          error: "Unknown child session ID.",
          sessionID: args.sessionID,
        });
      }

      if (orchestratorSessionID !== context.sessionID) {
        return JSON.stringify({
          status: "error",
          error: "Child session does not belong to this orchestrator session.",
          sessionID: args.sessionID,
          orchestratorSessionID,
        });
      }

      const metadata = registry.getChildSessionMetadata(args.sessionID);
      if (!metadata) {
        return JSON.stringify({
          status: "error",
          error: "Child session is tracked but metadata is missing.",
          sessionID: args.sessionID,
        });
      }

      const statusResult = await client.session.status();
      const statusType = statusResult.data?.[args.sessionID]?.type ?? null;
      const isBusy = statusType === "busy";

      if (args.refresh === true) {
        const messagesResult = await client.session.messages({
          sessionID: args.sessionID,
        });

        if (!messagesResult.error && messagesResult.data) {
          const latest = findLatestAssistantMessage(messagesResult.data);
          if (latest) {
            const excerpt = truncateText(
              extractTextFromParts(latest.parts),
              400
            );
            registry.recordObservedAssistantMessage(
              args.sessionID,
              Date.now(),
              excerpt
            );
          }
        }
      }

      const updatedMetadata =
        registry.getChildSessionMetadata(args.sessionID) ?? metadata;
      const lastActivityAt = registry.computeLastActivityAt(args.sessionID);
      const progress = computeProgress({
        state: updatedMetadata.state,
        isBusy,
      });

      return JSON.stringify({
        status: "ok",
        sessionID: updatedMetadata.childSessionID,
        orchestratorSessionID: updatedMetadata.orchestratorSessionID,
        title: updatedMetadata.title,
        state: updatedMetadata.state,
        progress,
        statusType,
        createdAt: updatedMetadata.createdAt,
        lastPromptAt: updatedMetadata.lastPromptAt,
        lastResultAt: updatedMetadata.lastResultAt,
        lastErrorAt: updatedMetadata.lastErrorAt,
        lastAssistantMessageAt: updatedMetadata.lastAssistantMessageAt,
        lastAssistantMessageExcerpt:
          updatedMetadata.lastAssistantMessageExcerpt,
        lastActivityAt,
        workspaceDirectory: updatedMetadata.workspaceDirectory,
        workspaceBranch: updatedMetadata.workspaceBranch,
        awaitingUserAnswers: registry.isAwaitingUserAnswers(args.sessionID),
        waitingForPlan: registry.isWaitingForPlan(args.sessionID),
      });
    },
  });
}

function computeProgress(input: {
  state: string;
  isBusy: boolean;
}): ChildSessionProgress {
  if (input.state === "result_received" || input.state === "error")
    return "done";
  if (input.isBusy) return "running";
  return "pending";
}

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 3) return trimmed.slice(0, Math.max(0, maxChars));
  return trimmed.slice(0, Math.max(0, maxChars - 3)) + "...";
}

function findLatestAssistantMessage(
  messages: Array<{
    info: { role: string; id: string };
    parts: Array<{ type: string; text?: string; ignored?: boolean }>;
  }>
): {
  info: { role: string; id: string };
  parts: Array<{ type: string; text?: string; ignored?: boolean }>;
} | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    if (message.info.role === "assistant") return message;
  }
  return null;
}

function extractTextFromParts(
  parts: Array<{ type: string; text?: string; ignored?: boolean }>
): string {
  return parts
    .filter((part) => part.type === "text" && !part.ignored)
    .map((part) => part.text ?? "")
    .join("\n");
}
