import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import { SessionRegistry } from "../session-registry";
import { createSessionPromptTool } from "./session-prompt";

describe("session_prompt plan-first", () => {
  test("first prompt to a new tracked child session uses plan agent", async () => {
    const registry = new SessionRegistry();
    registry.registerChildSession({
      childSessionID: "child-1",
      orchestratorSessionID: "orch-1",
      title: "child-1",
      createdAt: Date.now(),
      workspaceDirectory: "/tmp/worktree-child-1",
      workspaceBranch: "opencode/session/test",
    });

    const sent: Array<{
      sessionID: string;
      directory?: string;
      agent?: string;
      parts?: Array<{ type: string; text: string }>;
    }> = [];

    const client = {
      session: {
        promptAsync: async (input: any) => {
          sent.push(input);
          return { error: null, data: {} };
        },
      },
    } as unknown as OpencodeClient;

    const tool = createSessionPromptTool(client, registry);
    await tool.execute(
      {
        sessionID: "child-1",
        prompt: "Implement feature X.",
        agent: null,
      },
      {
        sessionID: "orch-1",
        messageID: "msg-1",
        agent: "orchestrator",
        directory: "/home/michal/Projects/opencode-cc",
        worktree: "/home/michal/Projects/opencode-cc",
        abort: new AbortController().signal,
        metadata: (input: any) => {
          void input;
        },
        ask: async (input: any) => {
          void input;
        },
      }
    );

    expect(sent.length).toBe(1);
    expect(sent[0]?.sessionID).toBe("child-1");
    expect(sent[0]?.directory).toBe("/tmp/worktree-child-1");
    expect(sent[0]?.agent).toBe("plan");
    const text = sent[0]?.parts?.[0]?.text ?? "";
    expect(text).toBe("Implement feature X.");
    expect(registry.shouldSendPlanningPrompt("child-1")).toBe(false);
  });

  test("subsequent prompts do not use plan agent", async () => {
    const registry = new SessionRegistry();
    registry.registerChildSession({
      childSessionID: "child-2",
      orchestratorSessionID: "orch-1",
      title: "child-2",
      createdAt: Date.now(),
      workspaceDirectory: "/tmp/worktree-child-2",
      workspaceBranch: "opencode/session/test-2",
    });

    const sent: Array<{
      sessionID: string;
      directory?: string;
      agent?: string;
      parts?: Array<{ type: string; text: string }>;
    }> = [];

    const client = {
      session: {
        promptAsync: async (input: any) => {
          sent.push(input);
          return { error: null, data: {} };
        },
      },
    } as unknown as OpencodeClient;

    const tool = createSessionPromptTool(client, registry);

    await tool.execute(
      {
        sessionID: "child-2",
        prompt: "Do the thing.",
        agent: null,
      },
      {
        sessionID: "orch-1",
        messageID: "msg-1",
        agent: "orchestrator",
        directory: "/home/michal/Projects/opencode-cc",
        worktree: "/home/michal/Projects/opencode-cc",
        abort: new AbortController().signal,
        metadata: (input: any) => {
          void input;
        },
        ask: async (input: any) => {
          void input;
        },
      }
    );

    await tool.execute(
      {
        sessionID: "child-2",
        prompt: "Second prompt.",
        agent: null,
      },
      {
        sessionID: "orch-1",
        messageID: "msg-2",
        agent: "orchestrator",
        directory: "/home/michal/Projects/opencode-cc",
        worktree: "/home/michal/Projects/opencode-cc",
        abort: new AbortController().signal,
        metadata: (input: any) => {
          void input;
        },
        ask: async (input: any) => {
          void input;
        },
      }
    );

    expect(sent.length).toBe(2);
    expect(sent[0]?.agent).toBe("plan");
    expect(sent[1]?.agent).toBeUndefined();
    const secondText = sent[1]?.parts?.[0]?.text ?? "";
    expect(secondText).toBe("Second prompt.");
  });
});
