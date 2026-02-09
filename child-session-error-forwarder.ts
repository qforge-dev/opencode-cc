import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import { SessionRegistry } from "./session-registry";

export class ChildSessionErrorForwarder {
  private readonly client: OpencodeClient;
  private readonly registry: SessionRegistry;
  private readonly defaultOrchestratorDirectory: string;

  public constructor(input: {
    client: OpencodeClient;
    registry: SessionRegistry;
    defaultOrchestratorDirectory: string;
  }) {
    this.client = input.client;
    this.registry = input.registry;
    this.defaultOrchestratorDirectory = input.defaultOrchestratorDirectory;
  }

  public async handleSessionError(input: {
    childSessionID: string;
    error: unknown;
  }): Promise<void> {
    const childSessionID = input.childSessionID;
    const orchestratorSessionID =
      this.registry.getOrchestratorSessionID(childSessionID);
    if (!orchestratorSessionID) return;

    const errorText = input.error ? JSON.stringify(input.error) : "Unknown error";
    const excerpt = truncateText(errorText, 400);
    this.registry.markError(childSessionID, Date.now(), excerpt);

    if (!this.registry.hasPendingForwardRequests(childSessionID)) return;

    const delivered = this.registry.shiftPendingForwardRequest(childSessionID);
    if (!delivered) return;

    const childOrchestratorDirectory =
      this.registry.getOrchestratorDirectory(childSessionID) ??
      this.defaultOrchestratorDirectory;
    const directory = childOrchestratorDirectory === null ? undefined : childOrchestratorDirectory;

    await this.client.session.prompt({
      sessionID: orchestratorSessionID,
      directory,
      agent: "orchestrator",
      parts: [
        {
          type: "text",
          text: `[Child session ${childSessionID} error]\n\n${errorText}`,
          synthetic: true,
          metadata: {
            childSessionID,
            status: "error",
            forwardToken: delivered.forwardToken,
          },
        },
      ],
    });
  }
}

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 3) return trimmed.slice(0, Math.max(0, maxChars));
  return trimmed.slice(0, Math.max(0, maxChars - 3)) + "...";
}
