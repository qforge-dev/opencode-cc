import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import { detectChildQuestions } from "./child-questions.ts";
import { ChildSessionForwardingResolver } from "./child-session-forwarding-resolver";
import { SessionRegistry } from "./session-registry.ts";

export async function handleStableIdle(input: {
  client: OpencodeClient;
  registry: SessionRegistry;
  childSessionID: string;
  orchestratorSessionID: string;
  orchestratorDirectory: string | null;
}): Promise<void> {
  const pending = input.registry.peekPendingForwardRequest(input.childSessionID);
  if (pending === null) return;

  const orchestratorDirectory = input.orchestratorDirectory === null ? undefined : input.orchestratorDirectory;
  const childDirectory = input.registry.getChildWorkspaceDirectory(input.childSessionID);

  const statusResult = await input.client.session.status({
    directory: childDirectory === null ? undefined : childDirectory,
  });
  if (statusResult.error || !statusResult.data) return;
  const status = statusResult.data?.[input.childSessionID];
  if (status?.type === "busy") return;

  const messagesResult = await input.client.session.messages({
    sessionID: input.childSessionID,
    directory: childDirectory === null ? undefined : childDirectory,
  });

  if (messagesResult.error) return;

  if (!messagesResult.data) return;

  const resolver = new ChildSessionForwardingResolver();
  const normalized = resolver.normalizeMessages(messagesResult.data);
  const forwardable = resolver.findForwardableAssistantMessage(normalized, pending);
  if (!forwardable) return;

  const delivered = input.registry.shiftPendingForwardRequest(input.childSessionID);
  if (!delivered) return;

  const alreadyDelivered = input.registry.getLastDeliveredAssistantMessageID(input.childSessionID);
  if (alreadyDelivered === forwardable.assistantMessageID) return;

  const text = forwardable.text;

  const questions = detectChildQuestions(text);

  const lastPromptAgent = input.registry.getLastPromptAgent(input.childSessionID);
  const statusLabel = lastPromptAgent === "plan" ? "plan" : "completed";

  await input.client.session.prompt({
    sessionID: input.orchestratorSessionID,
    directory: orchestratorDirectory,
    agent: "orchestrator",
    parts: [
      {
        type: "text",
        text: `[Child session ${input.childSessionID} ${statusLabel}]\n\n${text}`,
        synthetic: true,
        metadata: {
          childSessionID: input.childSessionID,
          status: statusLabel,
          assistantMessageID: forwardable.assistantMessageID,
          forwardToken: delivered.forwardToken,
        },
      },
    ],
  });

  if (questions.hasQuestions && questions.questionsText) {
    await input.client.session.prompt({
      sessionID: input.orchestratorSessionID,
      directory: orchestratorDirectory,
      agent: "orchestrator",
      parts: [
        {
          type: "text",
          text: `[Child session ${input.childSessionID} questions]\n\n${questions.questionsText}`,
          synthetic: true,
          metadata: {
            childSessionID: input.childSessionID,
            status: "questions",
            assistantMessageID: forwardable.assistantMessageID,
            forwardToken: delivered.forwardToken,
            source: questions.source,
          },
        },
      ],
    });
  }

  input.registry.setLastDeliveredAssistantMessageID(input.childSessionID, forwardable.assistantMessageID);
  input.registry.markResultReceived(input.childSessionID, Date.now(), truncateText(text, 400));
}

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 3) return trimmed.slice(0, Math.max(0, maxChars));
  return trimmed.slice(0, Math.max(0, maxChars - 3)) + "...";
}
