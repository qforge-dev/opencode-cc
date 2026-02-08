import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import { detectChildQuestions } from "./child-questions.ts";
import { REPO_RULES_TEXT } from "./repo-rules.ts";
import { SessionRegistry } from "./session-registry.ts";

export async function handleStableIdle(input: {
  client: OpencodeClient;
  registry: SessionRegistry;
  childSessionID: string;
  orchestratorSessionID: string;
  orchestratorDirectory: string | null;
}): Promise<void> {
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

  if (!messagesResult.data) {
    await input.client.session.prompt({
      sessionID: input.orchestratorSessionID,
      directory: orchestratorDirectory,
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
    });

    input.registry.markResultReceived(input.childSessionID, Date.now(), "No messages were returned.");
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

  const questions = detectChildQuestions(text);

  const pendingExecution = input.registry.getPendingExecutionPrompt(input.childSessionID);
  const isPlanStage = input.registry.isWaitingForPlan(input.childSessionID) && pendingExecution !== null;

  if (isPlanStage) {
    await input.client.session.prompt({
      sessionID: input.orchestratorSessionID,
      directory: orchestratorDirectory,
      agent: "orchestrator",
      parts: [
        {
          type: "text",
          text: `[Child session ${input.childSessionID} plan]\n\n${text}`,
          synthetic: true,
          metadata: {
            childSessionID: input.childSessionID,
            status: "plan",
            assistantMessageID: latest.info.id,
          },
        },
      ],
    });

    input.registry.recordObservedAssistantMessage(input.childSessionID, Date.now(), truncateText(text, 400));

    if (questions.hasQuestions && questions.questionsText) {
      await input.client.session.prompt({
        sessionID: input.orchestratorSessionID,
        directory: orchestratorDirectory,
        agent: "orchestrator",
        parts: [
          {
            type: "text",
            text:
              `[Child session ${input.childSessionID} questions]\n\n` +
              "Answer these in your next message. Auto-execution is paused until you answer.\n\n" +
              questions.questionsText,
            synthetic: true,
            metadata: {
              childSessionID: input.childSessionID,
              status: "questions",
              assistantMessageID: latest.info.id,
              source: questions.source,
            },
          },
        ],
      });

      input.registry.markAwaitingUserAnswers(input.childSessionID, text, questions.questionsText);
      input.registry.setLastDeliveredAssistantMessageID(input.childSessionID, latest.info.id);
      return;
    }

    input.registry.setLastDeliveredAssistantMessageID(input.childSessionID, latest.info.id);

    const executionPrompt = buildExecutionPrompt({
      approvedPlan: text,
      taskPrompt: pendingExecution.prompt,
      repoRules: REPO_RULES_TEXT,
    });

    const directory = input.registry.getChildWorkspaceDirectory(input.childSessionID);

    const executionResult = await input.client.session.promptAsync({
      sessionID: input.childSessionID,
      directory: directory === null ? undefined : directory,
      agent: "build",
      parts: [
        {
          type: "text",
          text: executionPrompt,
        },
      ],
    });

    if (executionResult.error) {
      await input.client.session.prompt({
        sessionID: input.orchestratorSessionID,
        directory: orchestratorDirectory,
        agent: "orchestrator",
        parts: [
          {
            type: "text",
            text: `[Child session ${input.childSessionID} error]\n\nFailed to start execution: ${String(executionResult.error)}`,
            synthetic: true,
            metadata: {
              childSessionID: input.childSessionID,
              status: "error",
            },
          },
        ],
      });

      input.registry.markError(
        input.childSessionID,
        Date.now(),
        truncateText(`Failed to start execution: ${String(executionResult.error)}`, 400),
      );
      return;
    }

    input.registry.markPromptSent(input.childSessionID, Date.now());
    input.registry.markExecutionPromptSent(input.childSessionID);
    return;
  }

  await input.client.session.prompt({
    sessionID: input.orchestratorSessionID,
    directory: orchestratorDirectory,
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
            assistantMessageID: latest.info.id,
            source: questions.source,
          },
        },
      ],
    });
  }

  input.registry.setLastDeliveredAssistantMessageID(input.childSessionID, latest.info.id);
  input.registry.markResultReceived(input.childSessionID, Date.now(), truncateText(text, 400));
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

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 3) return trimmed.slice(0, Math.max(0, maxChars));
  return trimmed.slice(0, Math.max(0, maxChars - 3)) + "...";
}

function buildExecutionPrompt(input: {
  approvedPlan: string;
  taskPrompt: string;
  repoRules: string;
}): string {
  return [
    "Proceed with execution using the approved plan.",
    "Follow repo-specific rules.",
    "",
    "Approved plan:",
    input.approvedPlan.trim(),
    "",
    "Task (from orchestrator):",
    input.taskPrompt.trim(),
    "",
    "Repo-specific rules and constraints:",
    input.repoRules.trim(),
  ].join("\n");
}
