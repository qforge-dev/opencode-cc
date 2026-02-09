import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { handleStableIdle } from "./child-session-idle-handler.ts";
import { SessionRegistry } from "./session-registry.ts";

describe("handleStableIdle", () => {
  test("delivers plan and questions without auto-executing", async () => {
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
    registry.markPromptSent("child-1", Date.now(), "plan");

    const promptCalls: any[] = [];
    const promptAsyncCalls: any[] = [];

    const client = {
      session: {
        status: async () => ({ error: null, data: { "child-1": { type: "idle" } } }),
        messages: async () => ({
          error: null,
          data: [{
            info: { role: "assistant", id: "a1" },
            parts: [{ type: "text", text: "## Plan\n- Step\n\n## Questions:\n- What is the target platform?\n- Should we add tests?" }],
          }],
        }),
        prompt: async (input: any) => {
          promptCalls.push(input);
          return { error: null, data: {} };
        },
        promptAsync: async (input: any) => {
          promptAsyncCalls.push(input);
          return { error: null, data: {} };
        },
      },
    } as unknown as OpencodeClient;

    await handleStableIdle({
      client: client as any,
      registry,
      childSessionID: "child-1",
      orchestratorSessionID: "orch-1",
      orchestratorDirectory: "/repo",
    });

    expect(promptCalls.length).toBe(2);
    expect(promptCalls[0]?.parts?.[0]?.text ?? "").toContain("[Child session child-1 plan]");
    expect(promptCalls[1]?.parts?.[0]?.text ?? "").toContain("[Child session child-1 questions]");
    expect(promptAsyncCalls.length).toBe(0);

    const meta = registry.getChildSessionMetadata("child-1");
    expect(meta?.state).toBe("result_received");
    expect(meta?.lastPromptAgent).toBe("plan");
    expect(meta?.lastAssistantMessageExcerpt ?? "").toContain("## Plan");
  });

  test("delivers plan without auto-executing", async () => {
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
    registry.markPromptSent("child-2", Date.now(), "plan");

    const promptCalls: any[] = [];
    const promptAsyncCalls: any[] = [];

    const client = {
      session: {
        status: async () => ({ error: null, data: { "child-2": { type: "idle" } } }),
        messages: async () => ({
          error: null,
          data: [{
            info: { role: "assistant", id: "a2" },
            parts: [{ type: "text", text: "## Plan\n- Step A\n- Step B" }],
          }],
        }),
        prompt: async (input: any) => {
          promptCalls.push(input);
          return { error: null, data: {} };
        },
        promptAsync: async (input: any) => {
          promptAsyncCalls.push(input);
          return { error: null, data: {} };
        },
      },
    } as unknown as OpencodeClient;

    await handleStableIdle({
      client: client as any,
      registry,
      childSessionID: "child-2",
      orchestratorSessionID: "orch-1",
      orchestratorDirectory: "/repo",
    });

    expect(promptCalls.length).toBe(1);
    expect(promptCalls[0]?.parts?.[0]?.text ?? "").toContain("[Child session child-2 plan]");
    expect(promptAsyncCalls.length).toBe(0);

    const meta = registry.getChildSessionMetadata("child-2");
    expect(meta?.state).toBe("result_received");
    expect(meta?.lastPromptAgent).toBe("plan");
  });
});
