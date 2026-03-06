import type { Logger, AgentSession } from '../../shared/provider/index';

// Re-export for backward compatibility
export type { AgentSession } from '../../shared/provider/index';
/** @deprecated Use AgentSession instead */
export type AgentExecutorPort = AgentSession;

export type SessionFactory = (sessionId: string, logger: Logger) => AgentSession;
/** @deprecated Use SessionFactory instead */
export type ExecutorFactory = SessionFactory;

/**
 * Tracks active sessions and their associations with WebSocket clients.
 */
export class AgentStore {
  private sessions: Map<string, AgentSession> = new Map();
  private clientSessions: Map<string, Set<string>> = new Map();
  private logger: Logger;
  private createSession: SessionFactory;

  constructor(logger: Logger, createSession: SessionFactory) {
    this.logger = logger;
    this.createSession = createSession;
  }

  create(sessionId: string, clientId: string): AgentSession {
    const session = this.createSession(sessionId, this.logger);

    this.sessions.set(sessionId, session);

    if (!this.clientSessions.has(clientId)) {
      this.clientSessions.set(clientId, new Set());
    }
    this.clientSessions.get(clientId)!.add(sessionId);

    return session;
  }

  get(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  remove(sessionId: string): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);

      for (const [, sessionIds] of this.clientSessions) {
        sessionIds.delete(sessionId);
        if (sessionIds.size === 0) {
          this.clientSessions.delete(sessionId);
        }
      }
    }
    return session;
  }

  getByClient(clientId: string): AgentSession[] {
    const sessionIds = this.clientSessions.get(clientId);
    if (!sessionIds) {
      return [];
    }

    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter((e): e is AgentSession => e !== undefined);
  }

  removeByClient(clientId: string): AgentSession[] {
    const sessionIds = this.clientSessions.get(clientId);
    if (!sessionIds) {
      return [];
    }

    const removed: AgentSession[] = [];
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (session) {
        this.sessions.delete(sessionId);
        removed.push(session);
      }
    }

    this.clientSessions.delete(clientId);
    return removed;
  }

  getAll(): AgentSession[] {
    return Array.from(this.sessions.values());
  }
}
