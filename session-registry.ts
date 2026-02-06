export class SessionRegistry {
  private readonly childToOrchestrator = new Map<string, string>();
  private readonly lastDeliveredAssistantMessageIDByChild = new Map<string, string | null>();

  public registerChildSession(childSessionID: string, orchestratorSessionID: string): void {
    this.childToOrchestrator.set(childSessionID, orchestratorSessionID);
    if (!this.lastDeliveredAssistantMessageIDByChild.has(childSessionID)) {
      this.lastDeliveredAssistantMessageIDByChild.set(childSessionID, null);
    }
  }

  public getOrchestratorSessionID(childSessionID: string): string | null {
    return this.childToOrchestrator.get(childSessionID) ?? null;
  }

  public isTrackedChildSession(childSessionID: string): boolean {
    return this.childToOrchestrator.has(childSessionID);
  }

  public getLastDeliveredAssistantMessageID(childSessionID: string): string | null {
    return this.lastDeliveredAssistantMessageIDByChild.get(childSessionID) ?? null;
  }

  public setLastDeliveredAssistantMessageID(childSessionID: string, messageID: string): void {
    if (!this.isTrackedChildSession(childSessionID)) return;
    this.lastDeliveredAssistantMessageIDByChild.set(childSessionID, messageID);
  }
}
