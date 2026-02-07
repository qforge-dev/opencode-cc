import fs from "node:fs";
import path from "node:path";

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
  private readonly storageFilePath: string;

  public constructor(storageDirectory: string | null = null) {
    this.storageFilePath = resolveStorageFilePath(storageDirectory);
  }

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

    const store = this.readStore();
    if (store.sessions[input.orchestratorSessionID]) return;

    const existing = store.sessions[input.childSessionID] ?? null;
    const createdAt = existing?.registration.createdAt ?? input.createdAt;
    const record: ChildSessionRecord = normalizeRecord(input.childSessionID, {
      version: 1,
      registration: {
        ...input,
        createdAt,
      },
      tracking: existing?.tracking ?? createDefaultTracking(),
      planFirstState: existing?.planFirstState ?? createDefaultPlanFirstState(),
      lastDeliveredAssistantMessageID: existing?.lastDeliveredAssistantMessageID ?? null,
    });

    store.sessions[input.childSessionID] = record;
    this.writeStore(store);
  }

  public listChildSessions(orchestratorSessionID: string): Array<ChildSessionMetadata> {
    const records = Object.values(this.readStore().sessions);
    return records
      .filter((record) => record.registration.orchestratorSessionID === orchestratorSessionID)
      .map((record) => ({ ...record.registration, ...record.tracking }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  public getChildSessionMetadata(childSessionID: string): ChildSessionMetadata | null {
    const record = this.readRecord(childSessionID);
    if (!record) return null;
    return { ...record.registration, ...record.tracking };
  }

  public markPromptSent(childSessionID: string, at: number): void {
    const record = this.readRecord(childSessionID);
    if (!record) return;
    this.writeRecord(childSessionID, {
      ...record,
      tracking: {
        ...record.tracking,
        lastPromptAt: at,
        state: "prompt_sent",
      },
    });
  }

  public markResultReceived(childSessionID: string, at: number, assistantExcerpt: string | null): void {
    const record = this.readRecord(childSessionID);
    if (!record) return;
    this.writeRecord(childSessionID, {
      ...record,
      tracking: {
        ...record.tracking,
        lastResultAt: at,
        lastAssistantMessageAt: at,
        lastAssistantMessageExcerpt: assistantExcerpt,
        state: "result_received",
      },
    });
  }

  public markError(childSessionID: string, at: number, assistantExcerpt: string | null): void {
    const record = this.readRecord(childSessionID);
    if (!record) return;
    this.writeRecord(childSessionID, {
      ...record,
      tracking: {
        ...record.tracking,
        lastErrorAt: at,
        lastAssistantMessageAt: at,
        lastAssistantMessageExcerpt: assistantExcerpt,
        state: "error",
      },
    });
  }

  public recordObservedAssistantMessage(childSessionID: string, at: number, assistantExcerpt: string | null): void {
    const record = this.readRecord(childSessionID);
    if (!record) return;
    this.writeRecord(childSessionID, {
      ...record,
      tracking: {
        ...record.tracking,
        lastAssistantMessageAt: at,
        lastAssistantMessageExcerpt: assistantExcerpt,
      },
    });
  }

  public computeLastActivityAt(childSessionID: string): number | null {
    const record = this.readRecord(childSessionID);
    if (!record) return null;
    const candidates: Array<number> = [record.registration.createdAt];
    if (record.tracking.lastPromptAt !== null) candidates.push(record.tracking.lastPromptAt);
    if (record.tracking.lastResultAt !== null) candidates.push(record.tracking.lastResultAt);
    if (record.tracking.lastErrorAt !== null) candidates.push(record.tracking.lastErrorAt);
    if (record.tracking.lastAssistantMessageAt !== null) candidates.push(record.tracking.lastAssistantMessageAt);
    return Math.max(...candidates);
  }

  public getOrchestratorSessionID(childSessionID: string): string | null {
    return this.readRecord(childSessionID)?.registration.orchestratorSessionID ?? null;
  }

  public isTrackedChildSession(childSessionID: string): boolean {
    return this.getOrchestratorSessionID(childSessionID) !== null;
  }

  public getChildWorkspaceDirectory(childSessionID: string): string | null {
    return this.readRecord(childSessionID)?.registration.workspaceDirectory ?? null;
  }

  public shouldSendPlanningPrompt(childSessionID: string): boolean {
    const state = this.readRecord(childSessionID)?.planFirstState ?? null;
    return state !== null && state.phase === "unstarted";
  }

  public markPlanningPromptSent(childSessionID: string, pendingExecution: PendingExecutionPrompt): void {
    const record = this.readRecord(childSessionID);
    if (!record) return;
    this.writeRecord(childSessionID, {
      ...record,
      planFirstState: {
        phase: "planning_sent",
        pendingExecution,
        planText: null,
        questionsText: null,
      },
    });
  }

  public resetPlanFirst(childSessionID: string): void {
    const record = this.readRecord(childSessionID);
    if (!record) return;
    this.writeRecord(childSessionID, {
      ...record,
      planFirstState: {
        phase: "unstarted",
        pendingExecution: null,
        planText: null,
        questionsText: null,
      },
    });
  }

  public isWaitingForPlan(childSessionID: string): boolean {
    const state = this.readRecord(childSessionID)?.planFirstState ?? null;
    return state !== null && state.phase === "planning_sent";
  }

  public isAwaitingUserAnswers(childSessionID: string): boolean {
    const state = this.readRecord(childSessionID)?.planFirstState ?? null;
    return state !== null && state.phase === "awaiting_answers";
  }

  public getPendingExecutionPrompt(childSessionID: string): PendingExecutionPrompt {
    const state = this.readRecord(childSessionID)?.planFirstState ?? null;
    if (!state) return null;
    return state.pendingExecution;
  }

  public getPendingPlanText(childSessionID: string): string | null {
    const state = this.readRecord(childSessionID)?.planFirstState ?? null;
    if (!state) return null;
    return state.planText;
  }

  public getPendingQuestionsText(childSessionID: string): string | null {
    const state = this.readRecord(childSessionID)?.planFirstState ?? null;
    if (!state) return null;
    return state.questionsText;
  }

  public markAwaitingUserAnswers(childSessionID: string, planText: string, questionsText: string): void {
    const record = this.readRecord(childSessionID);
    if (!record) return;
    if (record.planFirstState.pendingExecution === null) return;
    this.writeRecord(childSessionID, {
      ...record,
      planFirstState: {
        phase: "awaiting_answers",
        pendingExecution: record.planFirstState.pendingExecution,
        planText,
        questionsText,
      },
    });
  }

  public markExecutionPromptSent(childSessionID: string): void {
    const record = this.readRecord(childSessionID);
    if (!record) return;
    this.writeRecord(childSessionID, {
      ...record,
      planFirstState: {
        phase: "executing",
        pendingExecution: null,
        planText: null,
        questionsText: null,
      },
    });
  }

  public getChildSessionsAwaitingAnswers(orchestratorSessionID: string): string[] {
    return Object.values(this.readStore().sessions)
      .filter((record) => record.registration.orchestratorSessionID === orchestratorSessionID)
      .filter((record) => record.planFirstState.phase === "awaiting_answers")
      .map((record) => record.registration.childSessionID);
  }

  public isNestedOrchestrator(orchestratorSessionID: string): boolean {
    return this.isTrackedChildSession(orchestratorSessionID);
  }

  public getLastDeliveredAssistantMessageID(childSessionID: string): string | null {
    return this.readRecord(childSessionID)?.lastDeliveredAssistantMessageID ?? null;
  }

  public setLastDeliveredAssistantMessageID(childSessionID: string, messageID: string): void {
    const record = this.readRecord(childSessionID);
    if (!record) return;
    this.writeRecord(childSessionID, {
      ...record,
      lastDeliveredAssistantMessageID: messageID,
    });
  }

  private readRecord(childSessionID: string): ChildSessionRecord | null {
    const store = this.readStore();
    const existing = store.sessions[childSessionID] ?? null;
    if (!existing) return null;
    return normalizeRecord(childSessionID, existing);
  }

  private writeRecord(childSessionID: string, record: ChildSessionRecord): void {
    const store = this.readStore();
    store.sessions[childSessionID] = normalizeRecord(childSessionID, record);
    this.writeStore(store);
  }

  private readStore(): RegistryStore {
    const current = this.readRawStoreFromDisk();
    if (current) return normalizeStore(current);

    const migrated = this.migrateLegacyDirectory();
    if (migrated) return migrated;

    return {
      version: 1,
      sessions: {},
    };
  }

  private readRawStoreFromDisk(): unknown | null {
    try {
      if (!fs.existsSync(this.storageFilePath)) return null;
      const raw = fs.readFileSync(this.storageFilePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private writeStore(store: RegistryStore): void {
    try {
      fs.mkdirSync(path.dirname(this.storageFilePath), { recursive: true });
      const tmpName = `.${path.basename(this.storageFilePath)}.${process.pid}.${Date.now()}.tmp`;
      const tmpPath = path.join(path.dirname(this.storageFilePath), tmpName);
      fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2) + "\n", "utf8");
      fs.renameSync(tmpPath, this.storageFilePath);
    } catch {
      return;
    }
  }

  private migrateLegacyDirectory(): RegistryStore | null {
    const legacyDirectory = resolveLegacyDirectory(path.dirname(this.storageFilePath));
    try {
      if (!fs.existsSync(legacyDirectory)) return null;
      if (!fs.statSync(legacyDirectory).isDirectory()) return null;
      const entries = fs.readdirSync(legacyDirectory);
      const sessions: Record<string, ChildSessionRecord> = {};
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        if (entry.includes(".tmp")) continue;
        const filePath = path.join(legacyDirectory, entry);
        try {
          const raw = fs.readFileSync(filePath, "utf8");
          const parsed = JSON.parse(raw) as ChildSessionRecord;
          const id = parsed?.registration?.childSessionID ?? null;
          if (!id || typeof id !== "string") continue;
          sessions[id] = normalizeRecord(id, parsed);
        } catch {
          continue;
        }
      }

      const store: RegistryStore = {
        version: 1,
        sessions,
      };
      this.writeStore(store);
      return store;
    } catch {
      return null;
    }
  }
}

type ChildSessionRecord = {
  version: 1;
  registration: ChildSessionRegistration;
  tracking: ChildSessionTracking;
  lastDeliveredAssistantMessageID: string | null;
  planFirstState: PlanFirstState;
};

type RegistryStore = {
  version: 1;
  sessions: Record<string, ChildSessionRecord>;
};

function resolveStorageFilePath(storageDirectory: string | null): string {
  const directory = storageDirectory ?? resolveDefaultStorageDirectory();
  return path.join(directory, "session-registry.json");
}

function resolveDefaultStorageDirectory(): string {
  const cwd = process.cwd();
  const repoRoot = findRepoRoot(cwd) ?? cwd;
  return path.join(repoRoot, ".opencode", "opencode-cc");
}

function resolveLegacyDirectory(storageDirectory: string): string {
  return path.join(storageDirectory, "session-registry");
}

function findRepoRoot(startDirectory: string): string | null {
  let current = startDirectory;

  while (true) {
    if (path.basename(current) === ".opencode") {
      return path.dirname(current);
    }
    const marker = path.join(current, ".opencode");
    try {
      if (fs.existsSync(marker) && fs.statSync(marker).isDirectory()) return current;
    } catch {
      return null;
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function normalizeStore(raw: unknown): RegistryStore {
  const store = raw as any;
  if (!store || store.version !== 1) {
    return { version: 1, sessions: {} };
  }

  const sessions: Record<string, ChildSessionRecord> = {};
  const inputSessions = store.sessions && typeof store.sessions === "object" ? store.sessions : {};
  for (const [key, value] of Object.entries(inputSessions as Record<string, unknown>)) {
    const record = value as ChildSessionRecord;
    if (!record || record.version !== 1) continue;
    sessions[key] = normalizeRecord(key, record);
  }

  return { version: 1, sessions };
}

function createDefaultTracking(): ChildSessionTracking {
  return {
    lastPromptAt: null,
    lastResultAt: null,
    lastErrorAt: null,
    lastAssistantMessageAt: null,
    lastAssistantMessageExcerpt: null,
    state: "created",
  };
}

function createDefaultPlanFirstState(): PlanFirstState {
  return {
    phase: "unstarted",
    pendingExecution: null,
    planText: null,
    questionsText: null,
  };
}

function normalizeRecord(childSessionID: string, record: ChildSessionRecord): ChildSessionRecord {
  return {
    version: 1,
    registration: {
      childSessionID,
      orchestratorSessionID: record.registration.orchestratorSessionID ?? "",
      title: record.registration.title ?? childSessionID,
      createdAt: record.registration.createdAt ?? Date.now(),
      workspaceDirectory: record.registration.workspaceDirectory ?? null,
      workspaceBranch: record.registration.workspaceBranch ?? null,
    },
    tracking: {
      ...createDefaultTracking(),
      ...record.tracking,
    },
    lastDeliveredAssistantMessageID: record.lastDeliveredAssistantMessageID ?? null,
    planFirstState: {
      ...createDefaultPlanFirstState(),
      ...record.planFirstState,
    },
  };
}
