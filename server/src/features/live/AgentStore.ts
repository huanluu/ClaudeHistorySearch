import type { AgentExecutor } from '../../shared/runtime/index';
import type { Logger } from '../../shared/provider/index';

export type ExecutorFactory = (sessionId: string, logger: Logger) => AgentExecutor;

/**
 * Tracks active sessions and their associations with WebSocket clients.
 */
export class AgentStore {
  private sessions: Map<string, AgentExecutor> = new Map();
  private clientSessions: Map<string, Set<string>> = new Map();
  private logger: Logger;
  private createExecutor: ExecutorFactory;

  constructor(logger: Logger, createExecutor: ExecutorFactory) {
    this.logger = logger;
    this.createExecutor = createExecutor;
  }

  /**
   * Create a new session executor and track it.
   */
  create(sessionId: string, clientId: string): AgentExecutor {
    const executor = this.createExecutor(sessionId, this.logger);

    // Track session
    this.sessions.set(sessionId, executor);

    // Track client association
    if (!this.clientSessions.has(clientId)) {
      this.clientSessions.set(clientId, new Set());
    }
    this.clientSessions.get(clientId)!.add(sessionId);

    return executor;
  }

  /**
   * Get a session by ID.
   */
  get(sessionId: string): AgentExecutor | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Check if a session exists.
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Remove a session and return it.
   */
  remove(sessionId: string): AgentExecutor | undefined {
    const executor = this.sessions.get(sessionId);
    if (executor) {
      this.sessions.delete(sessionId);

      // Remove from client associations
      for (const [clientId, sessionIds] of this.clientSessions) {
        sessionIds.delete(sessionId);
        if (sessionIds.size === 0) {
          this.clientSessions.delete(clientId);
        }
      }
    }
    return executor;
  }

  /**
   * Get all sessions for a client.
   */
  getByClient(clientId: string): AgentExecutor[] {
    const sessionIds = this.clientSessions.get(clientId);
    if (!sessionIds) {
      return [];
    }

    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter((e): e is AgentExecutor => e !== undefined);
  }

  /**
   * Remove all sessions for a client.
   */
  removeByClient(clientId: string): AgentExecutor[] {
    const sessionIds = this.clientSessions.get(clientId);
    if (!sessionIds) {
      return [];
    }

    const removed: AgentExecutor[] = [];
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

  /**
   * Get all sessions.
   */
  getAll(): AgentExecutor[] {
    return Array.from(this.sessions.values());
  }
}
