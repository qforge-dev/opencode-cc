import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionRegistry } from "../session-registry";
import { createSessionPromptTool } from "./session-prompt";

describe("session_prompt", () => {
  test("passes through agent and records it", async () => {
    const storageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-cc-registry-"));
    const registry = new SessionRegistry(storageDirectory);
    registry.registerChildSession({
      childSessionID: "child-1",
      orchestratorSessionID: "orch-1",
      orchestratorDirectory: "/repo",
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
        messages: async (_input: any) => {
          return { error: null, data: [] };
        },
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
        agent: "plan",
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
    expect(text).toContain("Implement feature X.");
    expect(text).toContain("opencode_cc_forward_token:");

    const meta = registry.getChildSessionMetadata("child-1");
    expect(meta?.state).toBe("prompt_sent");
    expect(meta?.lastPromptAgent).toBe("plan");
    expect(registry.hasPendingForwardRequests("child-1")).toBe(true);
  });

  test("null agent uses session default", async () => {
    const storageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-cc-registry-"));
    const registry = new SessionRegistry(storageDirectory);
    registry.registerChildSession({
      childSessionID: "child-2",
      orchestratorSessionID: "orch-1",
      orchestratorDirectory: "/repo",
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
        messages: async (_input: any) => {
          return { error: null, data: [] };
        },
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

    expect(sent.length).toBe(1);
    expect(sent[0]?.agent).toBeUndefined();
    const meta = registry.getChildSessionMetadata("child-2");
    expect(meta?.lastPromptAgent).toBeNull();
    expect(registry.hasPendingForwardRequests("child-2")).toBe(true);
  });
});
