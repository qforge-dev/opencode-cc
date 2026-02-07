export type PlanFirstPhase = "unstarted" | "planning_sent" | "awaiting_answers" | "executing";

export type PendingExecutionPrompt = {
  prompt: string;
} | null;

type PlanFirstState = {
  phase: PlanFirstPhase;
  pendingExecution: PendingExecutionPrompt;
  planText: string | null;
  questionsText: string | null;
};

export type ChildSessionRegistration = {
  childSessionID: string;
  orchestratorSessionID: string;
  title: string;
  createdAt: number;
  workspaceDirectory: string | null;
  workspaceBranch: string | null;
};

export type ChildSessionState = "created" | "prompt_sent" | "result_received" | "error";

export type ChildSessionProgress = "pending" | "running" | "done";

export type ChildSessionMetadata = ChildSessionRegistration & {
  lastPromptAt: number | null;
  lastResultAt: number | null;
  lastErrorAt: number | null;
  lastAssistantMessageAt: number | null;
  lastAssistantMessageExcerpt: string | null;
  state: ChildSessionState;
};

type ChildSessionTracking = {
  lastPromptAt: number | null;
  lastResultAt: number | null;
  lastErrorAt: number | null;
  lastAssistantMessageAt: number | null;
  lastAssistantMessageExcerpt: string | null;
  state: ChildSessionState;
};

export class SessionRegistry {
  private readonly childToOrchestrator = new Map<string, string>();
  private readonly childrenByOrchestrator = new Map<string, Array<string>>();
  private readonly lastDeliveredAssistantMessageIDByChild = new Map<string, string | null>();
  private readonly planFirstStateByChild = new Map<string, PlanFirstState>();
  private readonly registrationByChild = new Map<string, ChildSessionRegistration>();
  private readonly trackingByChild = new Map<string, ChildSessionTracking>();

  public registerChildSession(childSessionID: string, orchestratorSessionID: string): void;
  public registerChildSession(input: ChildSessionRegistration): void;
  public registerChildSession(
    childSessionIDOrInput: string | ChildSessionRegistration,
    orchestratorSessionIDOrNull: string | null = null,
  ): void {
    const input: ChildSessionRegistration =
      typeof childSessionIDOrInput === "string"
        ? {
          childSessionID: childSessionIDOrInput,
          orchestratorSessionID: orchestratorSessionIDOrNull ?? "",
          title: childSessionIDOrInput,
          createdAt: Date.now(),
          workspaceDirectory: null,
          workspaceBranch: null,
        }
        : childSessionIDOrInput;

    if (!input.orchestratorSessionID.length) return;

    this.childToOrchestrator.set(input.childSessionID, input.orchestratorSessionID);
    this.registrationByChild.set(input.childSessionID, input);

    if (!this.childrenByOrchestrator.has(input.orchestratorSessionID)) {
      this.childrenByOrchestrator.set(input.orchestratorSessionID, []);
    }

    const children = this.childrenByOrchestrator.get(input.orchestratorSessionID);
    if (children && !children.includes(input.childSessionID)) {
      children.push(input.childSessionID);
    }

    if (!this.lastDeliveredAssistantMessageIDByChild.has(input.childSessionID)) {
      this.lastDeliveredAssistantMessageIDByChild.set(input.childSessionID, null);
    }

    if (!this.trackingByChild.has(input.childSessionID)) {
      this.trackingByChild.set(input.childSessionID, {
        lastPromptAt: null,
        lastResultAt: null,
        lastErrorAt: null,
        lastAssistantMessageAt: null,
        lastAssistantMessageExcerpt: null,
        state: "created",
      });
    }

    if (!this.planFirstStateByChild.has(input.childSessionID)) {
      this.planFirstStateByChild.set(input.childSessionID, {
        phase: "unstarted",
        pendingExecution: null,
        planText: null,
        questionsText: null,
      });
    }
  }

  public listChildSessions(orchestratorSessionID: string): Array<ChildSessionMetadata> {
    const children = this.childrenByOrchestrator.get(orchestratorSessionID) ?? [];
    const result: Array<ChildSessionMetadata> = [];

    for (const childSessionID of children) {
      const metadata = this.getChildSessionMetadata(childSessionID);
      if (metadata) result.push(metadata);
    }

    return result.sort((a, b) => a.createdAt - b.createdAt);
  }

  public getChildSessionMetadata(childSessionID: string): ChildSessionMetadata | null {
    const registration = this.registrationByChild.get(childSessionID) ?? null;
    const tracking = this.trackingByChild.get(childSessionID) ?? null;
    if (!registration || !tracking) return null;
    return {
      ...registration,
      ...tracking,
    };
  }

  public markPromptSent(childSessionID: string, at: number): void {
    const tracking = this.trackingByChild.get(childSessionID) ?? null;
    if (!tracking) return;
    this.trackingByChild.set(childSessionID, {
      ...tracking,
      lastPromptAt: at,
      state: "prompt_sent",
    });
  }

  public markResultReceived(childSessionID: string, at: number, assistantExcerpt: string | null): void {
    const tracking = this.trackingByChild.get(childSessionID) ?? null;
    if (!tracking) return;
    this.trackingByChild.set(childSessionID, {
      ...tracking,
      lastResultAt: at,
      lastAssistantMessageAt: at,
      lastAssistantMessageExcerpt: assistantExcerpt,
      state: "result_received",
    });
  }

  public markError(childSessionID: string, at: number, assistantExcerpt: string | null): void {
    const tracking = this.trackingByChild.get(childSessionID) ?? null;
    if (!tracking) return;
    this.trackingByChild.set(childSessionID, {
      ...tracking,
      lastErrorAt: at,
      lastAssistantMessageAt: at,
      lastAssistantMessageExcerpt: assistantExcerpt,
      state: "error",
    });
  }

  public recordObservedAssistantMessage(childSessionID: string, at: number, assistantExcerpt: string | null): void {
    const tracking = this.trackingByChild.get(childSessionID) ?? null;
    if (!tracking) return;
    this.trackingByChild.set(childSessionID, {
      ...tracking,
      lastAssistantMessageAt: at,
      lastAssistantMessageExcerpt: assistantExcerpt,
    });
  }

  public computeLastActivityAt(childSessionID: string): number | null {
    const registration = this.registrationByChild.get(childSessionID) ?? null;
    const tracking = this.trackingByChild.get(childSessionID) ?? null;
    if (!registration || !tracking) return null;
    const candidates: Array<number> = [registration.createdAt];
    if (tracking.lastPromptAt !== null) candidates.push(tracking.lastPromptAt);
    if (tracking.lastResultAt !== null) candidates.push(tracking.lastResultAt);
    if (tracking.lastErrorAt !== null) candidates.push(tracking.lastErrorAt);
    if (tracking.lastAssistantMessageAt !== null) candidates.push(tracking.lastAssistantMessageAt);
    return Math.max(...candidates);
  }

  public getOrchestratorSessionID(childSessionID: string): string | null {
    return this.childToOrchestrator.get(childSessionID) ?? null;
  }

  public isTrackedChildSession(childSessionID: string): boolean {
    return this.childToOrchestrator.has(childSessionID);
  }

  public getChildWorkspaceDirectory(childSessionID: string): string | null {
    return this.registrationByChild.get(childSessionID)?.workspaceDirectory ?? null;
  }

  public shouldSendPlanningPrompt(childSessionID: string): boolean {
    const state = this.planFirstStateByChild.get(childSessionID) ?? null;
    return state !== null && state.phase === "unstarted";
  }

  public markPlanningPromptSent(childSessionID: string, pendingExecution: PendingExecutionPrompt): void {
    const state = this.planFirstStateByChild.get(childSessionID) ?? null;
    if (!state) return;
    this.planFirstStateByChild.set(childSessionID, {
      phase: "planning_sent",
      pendingExecution,
      planText: null,
      questionsText: null,
    });
  }

  public resetPlanFirst(childSessionID: string): void {
    const state = this.planFirstStateByChild.get(childSessionID) ?? null;
    if (!state) return;
    this.planFirstStateByChild.set(childSessionID, {
      phase: "unstarted",
      pendingExecution: null,
      planText: null,
      questionsText: null,
    });
  }

  public isWaitingForPlan(childSessionID: string): boolean {
    const state = this.planFirstStateByChild.get(childSessionID) ?? null;
    return state !== null && state.phase === "planning_sent";
  }

  public isAwaitingUserAnswers(childSessionID: string): boolean {
    const state = this.planFirstStateByChild.get(childSessionID) ?? null;
    return state !== null && state.phase === "awaiting_answers";
  }

  public getPendingExecutionPrompt(childSessionID: string): PendingExecutionPrompt {
    const state = this.planFirstStateByChild.get(childSessionID) ?? null;
    if (!state) return null;
    return state.pendingExecution;
  }

  public getPendingPlanText(childSessionID: string): string | null {
    const state = this.planFirstStateByChild.get(childSessionID) ?? null;
    if (!state) return null;
    return state.planText;
  }

  public getPendingQuestionsText(childSessionID: string): string | null {
    const state = this.planFirstStateByChild.get(childSessionID) ?? null;
    if (!state) return null;
    return state.questionsText;
  }

  public markAwaitingUserAnswers(childSessionID: string, planText: string, questionsText: string): void {
    const state = this.planFirstStateByChild.get(childSessionID) ?? null;
    if (!state) return;
    if (state.pendingExecution === null) return;
    this.planFirstStateByChild.set(childSessionID, {
      phase: "awaiting_answers",
      pendingExecution: state.pendingExecution,
      planText,
      questionsText,
    });
  }

  public markExecutionPromptSent(childSessionID: string): void {
    const state = this.planFirstStateByChild.get(childSessionID) ?? null;
    if (!state) return;
    this.planFirstStateByChild.set(childSessionID, {
      phase: "executing",
      pendingExecution: null,
      planText: null,
      questionsText: null,
    });
  }

  public getChildSessionsAwaitingAnswers(orchestratorSessionID: string): string[] {
    const result: string[] = [];
    for (const [childSessionID, mappedOrchestratorSessionID] of this.childToOrchestrator.entries()) {
      if (mappedOrchestratorSessionID !== orchestratorSessionID) continue;
      const state = this.planFirstStateByChild.get(childSessionID) ?? null;
      if (state?.phase === "awaiting_answers") result.push(childSessionID);
    }
    return result;
  }

  public getLastDeliveredAssistantMessageID(childSessionID: string): string | null {
    return this.lastDeliveredAssistantMessageIDByChild.get(childSessionID) ?? null;
  }

  public setLastDeliveredAssistantMessageID(childSessionID: string, messageID: string): void {
    if (!this.isTrackedChildSession(childSessionID)) return;
    this.lastDeliveredAssistantMessageIDByChild.set(childSessionID, messageID);
  }
}
