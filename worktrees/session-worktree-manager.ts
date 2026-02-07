import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

export type ChildSessionWorkspaceKind = "git_worktree" | "fallback";

export type ChildSessionWorkspace = {
  kind: ChildSessionWorkspaceKind;
  directory: string;
  branch: string | null;
};

export class SessionWorktreeManager {
  public async createChildSessionWorkspace(input: {
    sessionID: string;
    title: string;
    directory: string;
    worktree: string;
    abort: AbortSignal;
  }): Promise<ChildSessionWorkspace> {
    const repoRoot = input.worktree;
    const canUseGitWorktrees = this.canCreateGitWorktree(repoRoot);
    if (!canUseGitWorktrees) {
      return {
        kind: "fallback",
        directory: input.directory,
        branch: null,
      };
    }

    const worktreesRoot = path.join(repoRoot, ".opencode", "worktrees");
    await mkdir(worktreesRoot, { recursive: true });

    const workspaceName = this.computeWorkspaceName({
      title: input.title,
      sessionID: input.sessionID,
      now: new Date(),
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (input.abort.aborted) {
        return {
          kind: "fallback",
          directory: input.directory,
          branch: null,
        };
      }

      const suffix = attempt === 0 ? "" : `_${attempt}`;
      const dirName = `${workspaceName}${suffix}`;
      const directory = path.join(worktreesRoot, dirName);
      const branch = `opencode/session/${dirName}`;

      const added = this.addWorktree({
        repoRoot,
        directory,
        branch,
      });

      if (added.ok) {
        return {
          kind: "git_worktree",
          directory,
          branch,
        };
      }
    }

    return {
      kind: "fallback",
      directory: input.directory,
      branch: null,
    };
  }

  public async cleanupWorkspace(workspaceDirectory: string): Promise<void> {
    const removed = this.removeWorktree(workspaceDirectory);
    if (removed.ok) return;
    await rm(workspaceDirectory, { recursive: true, force: true });
  }

  private canCreateGitWorktree(repoRoot: string): boolean {
    const isInside = this.runGit(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
    if (!isInside.ok) return false;
    const list = this.runGit(repoRoot, ["worktree", "list"]);
    return list.ok;
  }

  private addWorktree(input: { repoRoot: string; directory: string; branch: string }): { ok: boolean } {
    const result = this.runGit(input.repoRoot, [
      "worktree",
      "add",
      "-b",
      input.branch,
      input.directory,
    ]);

    if (result.ok) return { ok: true };
    const retryBranch = `${input.branch}-${this.randomToken(4)}`;
    const retried = this.runGit(input.repoRoot, [
      "worktree",
      "add",
      "-b",
      retryBranch,
      input.directory,
    ]);
    return { ok: retried.ok };
  }

  private removeWorktree(workspaceDirectory: string): { ok: boolean } {
    const repoRoot = this.findRepoRootFromWorktree(workspaceDirectory);
    if (repoRoot === null) return { ok: false };
    const result = this.runGit(repoRoot, ["worktree", "remove", "--force", workspaceDirectory]);
    return { ok: result.ok };
  }

  private findRepoRootFromWorktree(directory: string): string | null {
    const top = this.runGit(directory, ["rev-parse", "--show-toplevel"]);
    if (!top.ok) return null;
    const toplevel = top.stdout.trim();
    return toplevel.length ? toplevel : null;
  }

  private computeWorkspaceName(input: { title: string; sessionID: string; now: Date }): string {
    const timestamp = this.formatTimestamp(input.now);
    const titleSlug = this.slugify(input.title).slice(0, 40);
    const sessionSlug = this.slugify(input.sessionID).slice(0, 20);
    const token = this.randomToken(4);
    const parts = ["wt", timestamp, titleSlug, sessionSlug, token].filter((part) => part.length);
    return parts.join("_");
  }

  private formatTimestamp(now: Date): string {
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
  }

  private slugify(input: string): string {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+/, "")
      .replace(/_+$/, "");
  }

  private randomToken(bytes: number): string {
    return randomBytes(bytes).toString("hex");
  }

  private runGit(cwd: string, args: Array<string>): { ok: boolean; stdout: string; stderr: string } {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });

    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    return {
      ok: result.status === 0,
      stdout,
      stderr,
    };
  }
}
