import type { Logger } from '../../shared/provider/index';

/**
 * Port interface for agent executors.
 * Defined by the feature (domain owns the contract).
 * Implemented by shared/infra/runtime/AgentExecutor (structurally).
 */
export interface AgentExecutorPort {
  start(options: { prompt: string; workingDir: string; resumeSessionId?: string }): void;
  cancel(): void;
  getSessionId(): string;
  on(event: 'message', handler: (message: unknown) => void): unknown;
  on(event: 'error', handler: (error: string) => void): unknown;
  on(event: 'complete', handler: (exitCode: number) => void): unknown;
}

export type ExecutorFactory = (sessionId: string, logger: Logger) => AgentExecutorPort;

/**
 * Tracks active sessions and their associations with WebSocket clients.
 */
export class AgentStore {
  private sessions: Map<string, AgentExecutorPort> = new Map();
  private clientSessions: Map<string, Set<string>> = new Map();
  private logger: Logger;
  private createExecutor: ExecutorFactory;

  constructor(logger: Logger, createExecutor: ExecutorFactory) {
    this.logger = logger;
    this.createExecutor = createExecutor;
  }

  create(sessionId: string, clientId: string): AgentExecutorPort {
    const executor = this.createExecutor(sessionId, this.logger);

    this.sessions.set(sessionId, executor);

    if (!this.clientSessions.has(clientId)) {
      this.clientSessions.set(clientId, new Set());
    }
    this.clientSessions.get(clientId)!.add(sessionId);

    return executor;
  }

  get(sessionId: string): AgentExecutorPort | undefined {
    return this.sessions.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  remove(sessionId: string): AgentExecutorPort | undefined {
    const executor = this.sessions.get(sessionId);
    if (executor) {
      this.sessions.delete(sessionId);

      for (const [, sessionIds] of this.clientSessions) {
        sessionIds.delete(sessionId);
        if (sessionIds.size === 0) {
          this.clientSessions.delete(sessionId);
        }
      }
    }
    return executor;
  }

  getByClient(clientId: string): AgentExecutorPort[] {
    const sessionIds = this.clientSessions.get(clientId);
    if (!sessionIds) {
      return [];
    }

    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter((e): e is AgentExecutorPort => e !== undefined);
  }

  removeByClient(clientId: string): AgentExecutorPort[] {
    const sessionIds = this.clientSessions.get(clientId);
    if (!sessionIds) {
      return [];
    }

    const removed: AgentExecutorPort[] = [];
    for (const sessionId of sessionIds) {
      const executor = this.sessions.get(sessionId);
      if (executor) {
        this.sessions.delete(sessionId);
        removed.push(executor);
      }
    }

    this.clientSessions.delete(clientId);
    return removed;
  }

  getAll(): AgentExecutorPort[] {
    return Array.from(this.sessions.values());
  }
}
