import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import { handleStableIdle } from "./child-session-idle-handler.ts";
import { SessionRegistry } from "./session-registry.ts";

describe("handleStableIdle plan-first", () => {
  test("suppresses auto-execution when plan contains questions", async () => {
    const registry = new SessionRegistry();
    registry.registerChildSession({
      childSessionID: "child-1",
      orchestratorSessionID: "orch-1",
      title: "child-1",
      createdAt: Date.now(),
      workspaceDirectory: "/tmp/worktree-child-1",
      workspaceBranch: "opencode/session/test",
    });
    registry.markPlanningPromptSent("child-1", { prompt: "Do X" });

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
    });

    expect(promptCalls.length).toBe(2);
    expect(promptCalls[0]?.parts?.[0]?.text ?? "").toContain("[Child session child-1 plan]");
    expect(promptCalls[1]?.parts?.[0]?.text ?? "").toContain("[Child session child-1 questions]");
    expect(promptAsyncCalls.length).toBe(0);
    expect(registry.isAwaitingUserAnswers("child-1")).toBe(true);
    expect(registry.getPendingPlanText("child-1")).toContain("## Plan");
    expect(registry.getPendingQuestionsText("child-1")).toContain("What is the target platform?");

    const meta = registry.getChildSessionMetadata("child-1");
    expect(meta?.lastAssistantMessageExcerpt ?? "").toContain("## Plan");
  });

  test("auto-executes when plan has no questions", async () => {
    const registry = new SessionRegistry();
    registry.registerChildSession({
      childSessionID: "child-2",
      orchestratorSessionID: "orch-1",
      title: "child-2",
      createdAt: Date.now(),
      workspaceDirectory: "/tmp/worktree-child-2",
      workspaceBranch: "opencode/session/test-2",
    });
    registry.markPlanningPromptSent("child-2", { prompt: "Do Y" });

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
    });

    expect(promptCalls.length).toBe(1);
    expect(promptAsyncCalls.length).toBe(1);
    expect(promptAsyncCalls[0]?.directory).toBe("/tmp/worktree-child-2");
    expect(promptAsyncCalls[0]?.agent).toBe("build");
    expect(registry.isWaitingForPlan("child-2")).toBe(false);

    const meta = registry.getChildSessionMetadata("child-2");
    expect(meta?.state).toBe("prompt_sent");
  });
});
