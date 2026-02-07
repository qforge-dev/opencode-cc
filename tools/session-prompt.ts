import { tool } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import { SessionRegistry } from "../session-registry";

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
        .describe(
          "Agent name to use in the child session, or null to use default"
        ),
    },
    async execute(args, context) {
      const shouldPlanFirst = registry.shouldSendPlanningPrompt(args.sessionID);

      if (shouldPlanFirst) {
        registry.markPlanningPromptSent(args.sessionID, {
          prompt: args.prompt,
        });
      }

      const directory = registry.getChildWorkspaceDirectory(args.sessionID);

      if (directory !== null) {
        const ready = await waitForWorkspaceDirectoryReady({
          client,
          directory,
          abort: context.abort,
        });
        if (!ready) {
          if (shouldPlanFirst) registry.resetPlanFirst(args.sessionID);
          return JSON.stringify({
            status: "error",
            sessionID: args.sessionID,
            error: "Workspace directory is not ready to run prompts.",
          });
        }
      }

      const agentDirectory = directory ?? context.directory;
      const availableAgentNames = await fetchAvailableAgentNames(client, agentDirectory);
      const hasPlanAgent = availableAgentNames.has("plan");

      const promptText = shouldPlanFirst && !hasPlanAgent
        ? buildPlanFirstPrompt(args.prompt)
        : args.prompt;

      const result = await client.session.promptAsync({
        sessionID: args.sessionID,
        directory: directory === null ? undefined : directory,
        agent: resolvePromptAgent({
          shouldPlanFirst,
          hasPlanAgent,
          requestedAgent: args.agent,
        }),
        parts: [
          {
            type: "text",
            text: promptText,
          },
        ],
      });

      if (result.error) {
        if (shouldPlanFirst) registry.resetPlanFirst(args.sessionID);
        return JSON.stringify({
          status: "error",
          sessionID: args.sessionID,
          error: truncateText(String(result.error), 2000),
        });
      }

      if (registry.isTrackedChildSession(args.sessionID)) {
        registry.markPromptSent(args.sessionID, Date.now());
      }

      return JSON.stringify({
        status: "prompt_sent",
        sessionID: args.sessionID,
        planFirst: shouldPlanFirst,
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

function resolvePromptAgent(input: {
  shouldPlanFirst: boolean;
  hasPlanAgent: boolean;
  requestedAgent: string | null;
}): string | undefined {
  if (input.shouldPlanFirst && input.hasPlanAgent) return "plan";
  return input.requestedAgent ?? undefined;
}

function buildPlanFirstPrompt(taskPrompt: string): string {
  return [
    "You are in planning mode.",
    "Do not make any code changes yet.",
    "Produce a clear, step-by-step plan.",
    "If anything is ambiguous, ask targeted questions.",
    "",
    "Task:",
    taskPrompt.trim(),
  ].join("\n");
}

async function fetchAvailableAgentNames(
  client: OpencodeClient,
  directory: string
): Promise<Set<string>> {
  try {
    const result = await client.app.agents({
      directory,
    });

    const agents = result.data ?? [];
    const names = new Set<string>();
    for (const agent of agents) {
      const name = agent?.name ?? "";
      if (name.length) names.add(name);
    }
    return names;
  } catch {
    return new Set();
  }
}

async function waitForWorkspaceDirectoryReady(input: {
  client: OpencodeClient;
  directory: string;
  abort: AbortSignal;
}): Promise<boolean> {
  const anyClient = input.client as any;
  const hasPathGet = typeof anyClient?.path?.get === "function";
  const hasVcsGet = typeof anyClient?.vcs?.get === "function";
  if (!hasPathGet && !hasVcsGet) return true;

  const delaysMs = [50, 100, 200, 400, 800, 1200];

  for (const delayMs of delaysMs) {
    if (input.abort.aborted) return false;

    try {
      const result = hasPathGet
        ? await anyClient.path.get({ directory: input.directory })
        : await anyClient.vcs.get({ directory: input.directory });
      if (!result?.error && result?.data) return true;
    } catch {
      // ignore
    }

    await sleep(delayMs, input.abort);
  }

  return false;
}

async function sleep(ms: number, abort: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (abort.aborted) return;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    abort.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}
