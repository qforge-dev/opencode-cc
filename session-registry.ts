import fs from "node:fs";
import path from "node:path";

export type ChildSessionRegistration = {
  childSessionID: string;
  orchestratorSessionID: string;
  orchestratorDirectory: string | null;
  title: string;
  createdAt: number;
  workspaceDirectory: string | null;
  workspaceBranch: string | null;
};

export type PendingForwardRequest = {
  forwardToken: string;
  createdAt: number;
  afterMessageCount: number | null;
  afterAssistantMessageID: string | null;
};

export type ChildSessionState =
  | "created"
  | "prompt_sent"
  | "result_received"
  | "error";

export type ChildSessionProgress = "pending" | "running" | "done";

export type ChildSessionMetadata = ChildSessionRegistration & {
  lastPromptAt: number | null;
  lastPromptAgent: string | null;
  lastResultAt: number | null;
  lastErrorAt: number | null;
  lastAssistantMessageAt: number | null;
  lastAssistantMessageExcerpt: string | null;
  state: ChildSessionState;
};

type ChildSessionTracking = {
  lastPromptAt: number | null;
  lastPromptAgent: string | null;
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

  public registerChildSession(
    childSessionID: string,
    orchestratorSessionID: string
  ): void;
  public registerChildSession(input: ChildSessionRegistration): void;
  public registerChildSession(
    childSessionIDOrInput: string | ChildSessionRegistration,
    orchestratorSessionIDOrNull: string | null = null
  ): void {
    const input: ChildSessionRegistration =
      typeof childSessionIDOrInput === "string"
        ? {
            childSessionID: childSessionIDOrInput,
            orchestratorSessionID: orchestratorSessionIDOrNull ?? "",
            orchestratorDirectory: null,
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
        version: 2,
        registration: {
          ...input,
          orchestratorDirectory:
            input.orchestratorDirectory !== null
              ? input.orchestratorDirectory
              : existing?.registration.orchestratorDirectory ?? null,
          createdAt,
        },
        tracking: existing?.tracking ?? createDefaultTracking(),
        lastDeliveredAssistantMessageID:
          existing?.lastDeliveredAssistantMessageID ?? null,
        pendingForwardRequests: existing?.pendingForwardRequests ?? [],
      });

    store.sessions[input.childSessionID] = record;
    this.writeStore(store);
  }

  public listChildSessions(
    orchestratorSessionID: string
  ): Array<ChildSessionMetadata> {
    const records = Object.values(this.readStore().sessions);
    return records
      .filter(
        (record) =>
          record.registration.orchestratorSessionID === orchestratorSessionID
      )
      .map((record) => ({ ...record.registration, ...record.tracking }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  public getChildSessionMetadata(
    childSessionID: string
  ): ChildSessionMetadata | null {
    const record = this.readRecord(childSessionID);
    if (!record) return null;
    return { ...record.registration, ...record.tracking };
  }

  public markPromptSent(
    childSessionID: string,
    at: number,
    agent: string | null
  ): void {
    const record = this.readRecord(childSessionID);
    if (!record) return;
    this.writeRecord(childSessionID, {
      ...record,
      tracking: {
        ...record.tracking,
        lastPromptAt: at,
        lastPromptAgent: agent,
        state: "prompt_sent",
      },
    });
  }

  public markResultReceived(
    childSessionID: string,
    at: number,
    assistantExcerpt: string | null
  ): void {
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

  public markError(
    childSessionID: string,
    at: number,
    assistantExcerpt: string | null
  ): void {
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

  public recordObservedAssistantMessage(
    childSessionID: string,
    at: number,
    assistantExcerpt: string | null
  ): void {
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
    if (record.tracking.lastPromptAt !== null)
      candidates.push(record.tracking.lastPromptAt);
    if (record.tracking.lastResultAt !== null)
      candidates.push(record.tracking.lastResultAt);
    if (record.tracking.lastErrorAt !== null)
      candidates.push(record.tracking.lastErrorAt);
    if (record.tracking.lastAssistantMessageAt !== null)
      candidates.push(record.tracking.lastAssistantMessageAt);
    return Math.max(...candidates);
  }

  public getOrchestratorSessionID(childSessionID: string): string | null {
    return (
      this.readRecord(childSessionID)?.registration.orchestratorSessionID ??
      null
    );
  }

  public getOrchestratorDirectory(childSessionID: string): string | null {
    return this.readRecord(childSessionID)?.registration.orchestratorDirectory ?? null;
  }

  public isTrackedChildSession(childSessionID: string): boolean {
    return this.getOrchestratorSessionID(childSessionID) !== null;
  }

  public getChildWorkspaceDirectory(childSessionID: string): string | null {
    return (
      this.readRecord(childSessionID)?.registration.workspaceDirectory ?? null
    );
  }

  public getLastPromptAgent(childSessionID: string): string | null {
    return this.readRecord(childSessionID)?.tracking.lastPromptAgent ?? null;
  }

  public isNestedOrchestrator(orchestratorSessionID: string): boolean {
    return this.isTrackedChildSession(orchestratorSessionID);
  }

  public getLastDeliveredAssistantMessageID(
    childSessionID: string
  ): string | null {
    return (
      this.readRecord(childSessionID)?.lastDeliveredAssistantMessageID ?? null
    );
  }

  public setLastDeliveredAssistantMessageID(
    childSessionID: string,
    messageID: string
  ): void {
    const record = this.readRecord(childSessionID);
    if (!record) return;
    this.writeRecord(childSessionID, {
      ...record,
      lastDeliveredAssistantMessageID: messageID,
    });
  }

  public enqueuePendingForwardRequest(
    childSessionID: string,
    request: PendingForwardRequest
  ): void {
    const record = this.readRecord(childSessionID);
    if (!record) return;
    this.writeRecord(childSessionID, {
      ...record,
      pendingForwardRequests: [...record.pendingForwardRequests, request],
    });
  }

  public peekPendingForwardRequest(childSessionID: string): PendingForwardRequest | null {
    const record = this.readRecord(childSessionID);
    if (!record) return null;
    return record.pendingForwardRequests[0] ?? null;
  }

  public shiftPendingForwardRequest(childSessionID: string): PendingForwardRequest | null {
    const record = this.readRecord(childSessionID);
    if (!record) return null;
    const first = record.pendingForwardRequests[0] ?? null;
    if (!first) return null;
    this.writeRecord(childSessionID, {
      ...record,
      pendingForwardRequests: record.pendingForwardRequests.slice(1),
    });
    return first;
  }

  public hasPendingForwardRequests(childSessionID: string): boolean {
    return this.peekPendingForwardRequest(childSessionID) !== null;
  }

  public removePendingForwardRequest(
    childSessionID: string,
    forwardToken: string
  ): boolean {
    const record = this.readRecord(childSessionID);
    if (!record) return false;
    const before = record.pendingForwardRequests.length;
    const next = record.pendingForwardRequests.filter(
      (r) => r.forwardToken !== forwardToken
    );
    if (next.length === before) return false;
    this.writeRecord(childSessionID, {
      ...record,
      pendingForwardRequests: next,
    });
    return true;
  }

  private readRecord(childSessionID: string): ChildSessionRecord | null {
    const store = this.readStore();
    const existing = store.sessions[childSessionID] ?? null;
    if (!existing) return null;
    return normalizeRecord(childSessionID, existing);
  }

  private writeRecord(
    childSessionID: string,
    record: ChildSessionRecord
  ): void {
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
      version: 2,
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
      const tmpName = `.${path.basename(this.storageFilePath)}.${
        process.pid
      }.${Date.now()}.tmp`;
      const tmpPath = path.join(path.dirname(this.storageFilePath), tmpName);
      fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2) + "\n", "utf8");
      fs.renameSync(tmpPath, this.storageFilePath);
    } catch {
      return;
    }
  }

  private migrateLegacyDirectory(): RegistryStore | null {
    const legacyDirectory = resolveLegacyDirectory(
      path.dirname(this.storageFilePath)
    );
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
        version: 2,
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
  version: 2;
  registration: ChildSessionRegistration;
  tracking: ChildSessionTracking;
  lastDeliveredAssistantMessageID: string | null;
  pendingForwardRequests: Array<PendingForwardRequest>;
};

type RegistryStore = {
  version: 2;
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
      if (fs.existsSync(marker) && fs.statSync(marker).isDirectory())
        return current;
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
  if (!store || (store.version !== 1 && store.version !== 2)) {
    return { version: 2, sessions: {} };
  }

  const sessions: Record<string, ChildSessionRecord> = {};
  const inputSessions =
    store.sessions && typeof store.sessions === "object" ? store.sessions : {};
  for (const [key, value] of Object.entries(
    inputSessions as Record<string, unknown>
  )) {
    const record = value as ChildSessionRecord;
    if (!record || (record as any).version === undefined) continue;
    sessions[key] = normalizeRecord(key, record);
  }

  return { version: 2, sessions };
}

function createDefaultTracking(): ChildSessionTracking {
  return {
    lastPromptAt: null,
    lastPromptAgent: null,
    lastResultAt: null,
    lastErrorAt: null,
    lastAssistantMessageAt: null,
    lastAssistantMessageExcerpt: null,
    state: "created",
  };
}

function normalizeRecord(
  childSessionID: string,
  record: any
): ChildSessionRecord {
  return {
    version: 2,
    registration: {
      childSessionID,
      orchestratorSessionID: record.registration.orchestratorSessionID ?? "",
      orchestratorDirectory: record.registration.orchestratorDirectory ?? null,
      title: record.registration.title ?? childSessionID,
      createdAt: record.registration.createdAt ?? Date.now(),
      workspaceDirectory: record.registration.workspaceDirectory ?? null,
      workspaceBranch: record.registration.workspaceBranch ?? null,
    },
    tracking: {
      ...createDefaultTracking(),
      ...record.tracking,
    },
    lastDeliveredAssistantMessageID:
      record.lastDeliveredAssistantMessageID ?? null,
    pendingForwardRequests: normalizePendingForwardRequests(
      record.pendingForwardRequests
    ),
  };
}

function normalizePendingForwardRequests(
  raw: unknown
): Array<PendingForwardRequest> {
  if (!Array.isArray(raw)) return [];
  const output: Array<PendingForwardRequest> = [];
  for (const entry of raw) {
    const anyEntry = entry as any;
    const forwardToken = typeof anyEntry?.forwardToken === "string" ? anyEntry.forwardToken : "";
    if (!forwardToken.length) continue;
    const createdAt = typeof anyEntry?.createdAt === "number" ? anyEntry.createdAt : Date.now();
    const afterMessageCount = typeof anyEntry?.afterMessageCount === "number" ? anyEntry.afterMessageCount : null;
    const afterAssistantMessageID = typeof anyEntry?.afterAssistantMessageID === "string" ? anyEntry.afterAssistantMessageID : null;
    output.push({
      forwardToken,
      createdAt,
      afterMessageCount,
      afterAssistantMessageID,
    });
  }
  return output;
}
