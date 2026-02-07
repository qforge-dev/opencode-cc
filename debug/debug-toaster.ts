import type { OpencodeClient } from "@opencode-ai/sdk/v2";

export class DebugToaster {
  public static fromEnv(client: OpencodeClient): DebugToaster {
    const raw = String(process.env.OPENCODE_CC_DEBUG_TOASTS ?? "");
    const enabled = raw === "1" || raw.toLowerCase() === "true";
    return new DebugToaster(client, enabled);
  }

  public constructor(
    private readonly client: OpencodeClient,
    private readonly enabled: boolean
  ) {}

  public async show(input: {
    directory: string;
    title: string;
    message: string;
    variant: "info" | "success" | "warning" | "error";
    duration: number;
  }): Promise<void> {
    if (!this.enabled) return;
    if (!input.directory.trim().length) return;
    try {
      await this.client.tui.showToast({
        directory: input.directory,
        title: input.title,
        message: input.message,
        variant: input.variant,
        duration: input.duration,
      });
    } catch {
      return;
    }
  }
}
