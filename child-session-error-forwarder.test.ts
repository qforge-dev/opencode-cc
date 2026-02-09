import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ChildSessionErrorForwarder } from "./child-session-error-forwarder";
import { SessionRegistry } from "./session-registry";

describe("ChildSessionErrorForwarder", () => {
  test("does not forward error when no pending request", async () => {
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
      workspaceBranch: "branch-1",
    });

    const promptCalls: any[] = [];
    const client = {
      session: {
        prompt: async (input: any) => {
          promptCalls.push(input);
          return { error: null, data: {} };
        },
      },
    } as unknown as OpencodeClient;

    const forwarder = new ChildSessionErrorForwarder({
      client,
      registry,
      defaultOrchestratorDirectory: "/repo",
    });

    await forwarder.handleSessionError({
      childSessionID: "child-1",
      error: { message: "boom" },
    });

    expect(promptCalls.length).toBe(0);
    const meta = registry.getChildSessionMetadata("child-1");
    expect(meta?.state).toBe("error");
  });

  test("forwards error when pending request exists and clears one request", async () => {
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
      workspaceBranch: "branch-2",
    });

    registry.enqueuePendingForwardRequest("child-2", {
      forwardToken: "tok-1",
      createdAt: Date.now(),
      afterMessageCount: 0,
      afterAssistantMessageID: null,
    });

    const promptCalls: any[] = [];
    const client = {
      session: {
        prompt: async (input: any) => {
          promptCalls.push(input);
          return { error: null, data: {} };
        },
      },
    } as unknown as OpencodeClient;

    const forwarder = new ChildSessionErrorForwarder({
      client,
      registry,
      defaultOrchestratorDirectory: "/repo",
    });

    await forwarder.handleSessionError({
      childSessionID: "child-2",
      error: { message: "boom" },
    });

    expect(promptCalls.length).toBe(1);
    const text = promptCalls[0]?.parts?.[0]?.text ?? "";
    expect(text).toContain("[Child session child-2 error]");
    expect(promptCalls[0]?.parts?.[0]?.metadata?.forwardToken ?? null).toBe(
      "tok-1"
    );
    expect(registry.hasPendingForwardRequests("child-2")).toBe(false);
  });
});
