import type { PendingForwardRequest } from "./session-registry";

export type SessionMessage = {
  info: { role: string; id: string };
  parts: Array<{ type: string; text: string | null; ignored: boolean | null }>;
};

export type ForwardableAssistantMessage = {
  assistantMessageID: string;
  text: string;
};

export class ChildSessionForwardingResolver {
  public normalizeMessages(raw: Array<any>): Array<SessionMessage> {
    return raw
      .map((msg) => {
        const info = msg?.info ?? {};
        const parts = Array.isArray(msg?.parts) ? msg.parts : [];
        return {
          info: {
            role: typeof info?.role === "string" ? info.role : "",
            id: typeof info?.id === "string" ? info.id : "",
          },
          parts: parts
            .filter((p: any) => p && typeof p.type === "string")
            .map((p: any) => ({
              type: String(p.type),
              text: typeof p.text === "string" ? p.text : null,
              ignored: typeof p.ignored === "boolean" ? p.ignored : null,
            })),
        };
      })
      .filter((m) => m.info.id.length > 0);
  }

  public findForwardableAssistantMessage(
    messages: Array<SessionMessage>,
    request: PendingForwardRequest
  ): ForwardableAssistantMessage | null {
    const startIndex = this.resolveStartIndex(messages, request);
    const token = request.forwardToken;
    let found: ForwardableAssistantMessage | null = null;

    for (let i = startIndex; i < messages.length; i += 1) {
      const msg = messages[i];
      if (!msg) continue;
      if (msg.info.role !== "assistant") continue;
      const rawText = this.extractTextFromParts(msg.parts);
      if (!rawText.trim().length) continue;
      if (!this.containsToken(rawText, token)) continue;
      const cleaned = this.stripToken(rawText, token).trim();
      if (!cleaned.length) continue;
      found = { assistantMessageID: msg.info.id, text: cleaned };
    }

    return found;
  }

  public createTriggerMarker(messages: Array<SessionMessage>): {
    afterMessageCount: number;
    afterAssistantMessageID: string | null;
  } {
    const afterMessageCount = messages.length;
    const afterAssistantMessageID = this.findLatestAssistantMessageID(messages);
    return { afterMessageCount, afterAssistantMessageID };
  }

  private resolveStartIndex(
    messages: Array<SessionMessage>,
    request: PendingForwardRequest
  ): number {
    const count = request.afterMessageCount;
    if (count !== null && count >= 0) {
      if (count <= messages.length) return count;
      return 0;
    }

    const id = request.afterAssistantMessageID;
    if (id !== null && id.length) {
      const idx = messages.findIndex((m) => m?.info?.id === id);
      if (idx >= 0) return idx + 1;
    }

    return 0;
  }

  private findLatestAssistantMessageID(messages: Array<SessionMessage>): string | null {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (!msg) continue;
      if (msg.info.role !== "assistant") continue;
      return msg.info.id;
    }
    return null;
  }

  private extractTextFromParts(
    parts: Array<{ type: string; text: string | null; ignored: boolean | null }>
  ): string {
    return parts
      .filter((part) => part.type === "text" && part.ignored !== true)
      .map((part) => part.text ?? "")
      .join("\n");
  }

  private containsToken(text: string, token: string): boolean {
    return text.includes(this.buildTokenLine(token));
  }

  private stripToken(text: string, token: string): string {
    const line = this.buildTokenLine(token);
    return text
      .split("\n")
      .filter((l) => l.trim() !== line)
      .join("\n");
  }

  private buildTokenLine(token: string): string {
    return `opencode_cc_forward_token: ${token}`;
  }
}
