import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { rewritePromptPathsForChildWorktree } from "./path-rewriter";

describe("rewritePromptPathsForChildWorktree", () => {
  test("rewrites absolute orchestrator paths to child-relative paths", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-cc-path-rewrite-"));
    const orchRoot = path.join(tmp, "orch");
    const childRoot = path.join(tmp, "child");
    const orchDir = path.join(orchRoot, "packages", "pkg");
    const absFile = path.join(orchRoot, "packages", "pkg", "src", "index.ts");

    fs.mkdirSync(path.join(orchRoot, "packages", "pkg", "src"), { recursive: true });
    fs.mkdirSync(childRoot, { recursive: true });
    fs.mkdirSync(path.join(orchRoot, ".git"), { recursive: true });
    fs.mkdirSync(path.join(childRoot, ".git"), { recursive: true });
    fs.writeFileSync(absFile, "export {}\n", "utf8");

    const input = `Please update \`${absFile}:12\` and also check "${absFile}#L5".`;
    const result = rewritePromptPathsForChildWorktree({
      text: input,
      orchestratorDirectory: orchDir,
      childWorkspaceDirectory: childRoot,
    });

    expect(result.errors.length).toBe(0);
    expect(result.rewrittenCount).toBe(2);
    expect(result.text).toContain("`packages/pkg/src/index.ts:12`");
    expect(result.text).toContain('"packages/pkg/src/index.ts#L5"');
  });

  test("rewrites ./ and ../ paths based on orchestrator directory", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-cc-path-rewrite-"));
    const orchRoot = path.join(tmp, "orch");
    const childRoot = path.join(tmp, "child");
    const orchDir = path.join(orchRoot, "apps", "web");

    fs.mkdirSync(path.join(orchRoot, "apps", "web", "src"), { recursive: true });
    fs.mkdirSync(path.join(orchRoot, ".git"), { recursive: true });
    fs.mkdirSync(path.join(childRoot, ".git"), { recursive: true });

    const input = "Open ./src/main.ts and ../shared/util.ts";
    const result = rewritePromptPathsForChildWorktree({
      text: input,
      orchestratorDirectory: orchDir,
      childWorkspaceDirectory: childRoot,
    });

    expect(result.errors.length).toBe(0);
    expect(result.text).toContain("apps/web/src/main.ts");
    expect(result.text).toContain("apps/shared/util.ts");
  });
});
