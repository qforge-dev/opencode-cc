import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { handleStableIdle } from "./child-session-idle-handler.ts";
import { SessionRegistry } from "./session-registry.ts";

describe("handleStableIdle correlation forwarding", () => {
  test("direct child chat does not forward on idle", async () => {
    const storageDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "opencode-cc-registry-")
    );
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

    const promptCalls: any[] = [];

    const client = {
      session: {
        status: async () => ({ error: null, data: { "child-1": { type: "idle" } } }),
        messages: async () => ({
          error: null,
          data: [
            {
              info: { role: "assistant", id: "a1" },
              parts: [{ type: "text", text: "Hello from direct chat." }],
            },
          ],
        }),
        prompt: async (input: any) => {
          promptCalls.push(input);
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

    expect(promptCalls.length).toBe(0);
    expect(registry.hasPendingForwardRequests("child-1")).toBe(false);
    const meta = registry.getChildSessionMetadata("child-1");
    expect(meta?.state).toBe("created");
  });

  test("orchestrator prompt forwards assistant output tagged with token", async () => {
    const storageDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "opencode-cc-registry-")
    );
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

    const token = "token-123";
    registry.enqueuePendingForwardRequest("child-2", {
      forwardToken: token,
      createdAt: Date.now(),
      afterMessageCount: 0,
      afterAssistantMessageID: null,
    });

    const promptCalls: any[] = [];

    const client = {
      session: {
        status: async () => ({ error: null, data: { "child-2": { type: "idle" } } }),
        messages: async () => ({
          error: null,
          data: [
            {
              info: { role: "assistant", id: "a2" },
              parts: [
                {
                  type: "text",
                  text: [
                    "## Plan",
                    "- Step A",
                    "",
                    `opencode_cc_forward_token: ${token}`,
                  ].join("\n"),
                },
              ],
            },
          ],
        }),
        prompt: async (input: any) => {
          promptCalls.push(input);
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
    const forwardedText = promptCalls[0]?.parts?.[0]?.text ?? "";
    expect(forwardedText).toContain("[Child session child-2 completed]");
    expect(forwardedText).toContain("## Plan");
    expect(forwardedText).not.toContain(`opencode_cc_forward_token: ${token}`);
    expect(registry.hasPendingForwardRequests("child-2")).toBe(false);
  });

  test("tool call messages do not prevent forwarding final tagged assistant output", async () => {
    const storageDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "opencode-cc-registry-")
    );
    const registry = new SessionRegistry(storageDirectory);
    registry.registerChildSession({
      childSessionID: "child-3",
      orchestratorSessionID: "orch-1",
      orchestratorDirectory: "/repo",
      title: "child-3",
      createdAt: Date.now(),
      workspaceDirectory: "/tmp/worktree-child-3",
      workspaceBranch: "opencode/session/test-3",
    });

    const token = "token-456";
    registry.enqueuePendingForwardRequest("child-3", {
      forwardToken: token,
      createdAt: Date.now(),
      afterMessageCount: 0,
      afterAssistantMessageID: null,
    });

    const promptCalls: any[] = [];

    const client = {
      session: {
        status: async () => ({ error: null, data: { "child-3": { type: "idle" } } }),
        messages: async () => ({
          error: null,
          data: [
            {
              info: { role: "assistant", id: "a3-tool" },
              parts: [{ type: "text", text: "" }],
            },
            {
              info: { role: "tool", id: "t1" },
              parts: [{ type: "text", text: "tool result" }],
            },
            {
              info: { role: "assistant", id: "a3-final" },
              parts: [
                {
                  type: "text",
                  text: [
                    "Final answer after tools.",
                    `opencode_cc_forward_token: ${token}`,
                  ].join("\n"),
                },
              ],
            },
          ],
        }),
        prompt: async (input: any) => {
          promptCalls.push(input);
          return { error: null, data: {} };
        },
      },
    } as unknown as OpencodeClient;

    await handleStableIdle({
      client: client as any,
      registry,
      childSessionID: "child-3",
      orchestratorSessionID: "orch-1",
      orchestratorDirectory: "/repo",
    });

    expect(promptCalls.length).toBe(1);
    const forwardedText = promptCalls[0]?.parts?.[0]?.text ?? "";
    expect(forwardedText).toContain("Final answer after tools.");
    expect(forwardedText).not.toContain(`opencode_cc_forward_token: ${token}`);
    expect(registry.hasPendingForwardRequests("child-3")).toBe(false);
  });
});
