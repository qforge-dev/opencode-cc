import type { OpencodeClient } from "@opencode-ai/sdk/v2";

export type ChildSessionWorkspace = {
  directory: string;
  branch: string | null;
};

export class SessionWorktreeManager {
  public constructor(private readonly client: OpencodeClient) {}

  public async createChildSessionWorkspace(input: {
    sessionID: string;
    title: string;
    directory: string;
    worktree: string;
    abort: AbortSignal;
  }): Promise<ChildSessionWorkspace> {
    if (input.abort.aborted) {
      return {
        directory: input.directory,
        branch: null,
      };
    }

    const name = this.computeWorkspaceName({
      title: input.title,
      sessionID: input.sessionID,
      now: new Date(),
    });

    try {
      const result = await this.client.worktree.create({
        directory: input.worktree,
        worktreeCreateInput: {
          name,
        },
      });

      if (result.error || !result.data) {
        return {
          directory: input.directory,
          branch: null,
        };
      }

      return {
        directory: result.data.directory,
        branch: result.data.branch,
      };
    } catch {
      return {
        directory: input.directory,
        branch: null,
      };
    }
  }

  public async cleanupWorkspace(workspaceDirectory: string): Promise<void> {
    try {
      await this.client.worktree.remove({
        worktreeRemoveInput: {
          directory: workspaceDirectory,
        },
      });
    } catch {
      return;
    }
  }

  private computeWorkspaceName(input: { title: string; sessionID: string; now: Date }): string {
    const timestamp = this.formatTimestamp(input.now);
    const titleSlug = this.slugify(input.title).slice(0, 40);
    const sessionSlug = this.slugify(input.sessionID).slice(0, 20);
    const parts = ["wt", timestamp, titleSlug, sessionSlug].filter((part) => part.length);
    return parts.join("_");
  }

  private formatTimestamp(now: Date): string {
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const ms = String(now.getMilliseconds()).padStart(3, "0");
    return `${yyyy}${mm}${dd}${hh}${min}${ss}${ms}`;
  }

  private slugify(input: string): string {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+/, "")
      .replace(/_+$/, "");
  }
}
