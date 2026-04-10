import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../utils/logger.js";
import { SerialTaskQueue } from "../utils/queue.js";

export interface PersistedSessionState {
  sessionId: string | null;
  lastSeq: number | null;
  updatedAt: string;
}

export interface KnownUserRecord {
  accountId: string;
  kind: "c2c" | "group" | "guild" | "dm";
  senderId: string;
  senderName?: string;
  openid?: string;
  groupOpenid?: string;
  channelId?: string;
  guildId?: string;
  lastSeenAt: string;
}

interface AccountStateFile {
  session: PersistedSessionState | null;
  knownUsers: KnownUserRecord[];
}

const EMPTY_STATE: AccountStateFile = {
  session: null,
  knownUsers: [],
};

export class JsonStateStore {
  private readonly queue = new SerialTaskQueue();
  private readonly accountsDir: string;
  private initialized = false;

  constructor(
    private readonly rootDir: string,
    private readonly logger: Logger,
  ) {
    this.accountsDir = path.join(rootDir, "accounts");
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await fs.mkdir(this.accountsDir, { recursive: true });
    this.initialized = true;
  }

  async loadSession(accountId: string): Promise<PersistedSessionState | null> {
    const state = await this.readAccountState(accountId);
    return state.session;
  }

  async saveSession(
    accountId: string,
    sessionId: string | null,
    lastSeq: number | null,
  ): Promise<void> {
    await this.queue.run(`session:${accountId}`, async () => {
      const state = await this.readAccountState(accountId);
      state.session = {
        sessionId,
        lastSeq,
        updatedAt: new Date().toISOString(),
      };
      await this.writeAccountState(accountId, state);
    });
  }

  async clearSession(accountId: string): Promise<void> {
    await this.queue.run(`session:${accountId}`, async () => {
      const state = await this.readAccountState(accountId);
      state.session = null;
      await this.writeAccountState(accountId, state);
    });
  }

  async recordKnownUser(record: KnownUserRecord): Promise<void> {
    await this.queue.run(`known:${record.accountId}`, async () => {
      const state = await this.readAccountState(record.accountId);
      const key = this.buildKnownUserKey(record);
      const nextUsers = state.knownUsers.filter((entry) => this.buildKnownUserKey(entry) !== key);
      nextUsers.unshift(record);
      state.knownUsers = nextUsers.slice(0, 500);
      await this.writeAccountState(record.accountId, state);
    });
  }

  async listKnownUsers(accountId: string, kind?: KnownUserRecord["kind"]): Promise<KnownUserRecord[]> {
    const state = await this.readAccountState(accountId);
    return state.knownUsers.filter((entry) => (kind ? entry.kind === kind : true));
  }

  async countKnownUsers(accountId: string): Promise<number> {
    const users = await this.listKnownUsers(accountId);
    return users.length;
  }

  getAttachmentsDir(accountId: string): string {
    return path.join(this.rootDir, "attachments", accountId);
  }

  private accountPath(accountId: string): string {
    return path.join(this.accountsDir, `${accountId}.json`);
  }

  private async readAccountState(accountId: string): Promise<AccountStateFile> {
    await this.init();
    const filePath = this.accountPath(accountId);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AccountStateFile>;
      return {
        session: parsed.session ?? null,
        knownUsers: Array.isArray(parsed.knownUsers) ? parsed.knownUsers : [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return { ...EMPTY_STATE };
      }
      this.logger.warn(`Failed to read account state for ${accountId}, recreating`, error);
      return { ...EMPTY_STATE };
    }
  }

  private async writeAccountState(accountId: string, state: AccountStateFile): Promise<void> {
    await this.init();
    const filePath = this.accountPath(accountId);
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
  }

  private buildKnownUserKey(record: KnownUserRecord): string {
    switch (record.kind) {
      case "c2c":
        return `${record.kind}:${record.openid ?? record.senderId}`;
      case "group":
        return `${record.kind}:${record.groupOpenid ?? record.senderId}`;
      case "guild":
        return `${record.kind}:${record.channelId ?? record.senderId}`;
      case "dm":
        return `${record.kind}:${record.guildId ?? record.senderId}`;
    }
  }
}
