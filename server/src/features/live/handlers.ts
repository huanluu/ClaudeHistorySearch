import type { Logger, WorkingDirValidator } from '../../shared/provider/index';
import type {
  AuthenticatedClient,
  SessionStartPayload,
  SessionResumePayload,
  SessionCancelPayload,
  WsGateway,
} from '../../gateway/index';
import type { AgentStore } from './AgentStore';

export interface LiveHandlerDeps {
  agentStore: AgentStore;
  validator?: WorkingDirValidator;
  logger: Logger;
}

/**
 * Register WebSocket handlers for live session management.
 * Handles session.start, session.resume, session.cancel, and client disconnect cleanup.
 */
export function registerLiveHandlers(gateway: WsGateway, deps: LiveHandlerDeps): void {
  const { agentStore, validator, logger } = deps;

  gateway.on('session.start', (client, payload) => {
    const p = payload as SessionStartPayload;
    logger.log({
      msg: `session.start received: sessionId=${p.sessionId}`,
      op: 'ws.message',
      context: { sessionId: p.sessionId, promptPreview: p.prompt.substring(0, 50) },
    });

    const workingDir = validateWorkingDir(client, p.sessionId, p.workingDir, validator, logger);
    if (!workingDir) return;

    const executor = agentStore.create(p.sessionId, client.clientId);
    wireSessionEvents(client, executor, p.sessionId, agentStore, logger);

    executor.start({ prompt: p.prompt, workingDir });
    logger.log({ msg: `session.start: executor started`, op: 'ws.message', context: { sessionId: p.sessionId } });
  });

  gateway.on('session.resume', (client, payload) => {
    const p = payload as SessionResumePayload;
    logger.log({
      msg: `session.resume received: sessionId=${p.sessionId}, resumeSessionId=${p.resumeSessionId}`,
      op: 'ws.message',
      context: { sessionId: p.sessionId, resumeSessionId: p.resumeSessionId },
    });

    const workingDir = validateWorkingDir(client, p.sessionId, p.workingDir, validator, logger);
    if (!workingDir) return;

    const executor = agentStore.create(p.sessionId, client.clientId);
    wireSessionEvents(client, executor, p.sessionId, agentStore, logger);

    executor.start({ prompt: p.prompt, workingDir, resumeSessionId: p.resumeSessionId });
    logger.log({ msg: `session.resume: executor started`, op: 'ws.message', context: { sessionId: p.sessionId } });
  });

  gateway.on('session.cancel', (_client, payload) => {
    const p = payload as SessionCancelPayload;
    const executor = agentStore.get(p.sessionId);
    if (executor) {
      executor.cancel();
    }
  });

  gateway.onDisconnect((client) => {
    const sessions = agentStore.removeByClient(client.clientId);
    for (const executor of sessions) {
      executor.cancel();
    }
  });
}

function validateWorkingDir(
  client: AuthenticatedClient,
  sessionId: string,
  workingDir: string,
  validator: WorkingDirValidator | undefined,
  logger: Logger,
): string | null {
  if (!validator) {
    return workingDir;
  }

  const result = validator.validate(workingDir);
  if (!result.allowed) {
    logger.log({ msg: `Working directory rejected: ${workingDir} - ${result.error}`, op: 'ws.message', context: { workingDir, error: result.error } });
    client.send({
      type: 'session.error',
      payload: { sessionId, error: result.error },
    });
    return null;
  }

  return result.resolvedPath ?? workingDir;
}

interface EventSource {
  on(event: 'message', handler: (message: unknown) => void): unknown;
  on(event: 'error', handler: (error: string) => void): unknown;
  on(event: 'complete', handler: (exitCode: number) => void): unknown;
}

function wireSessionEvents(
  client: AuthenticatedClient,
  executor: EventSource,
  sessionId: string,
  agentStore: AgentStore,
  logger: Logger,
): void {
  logger.verbose({ msg: `Wiring session events for: ${sessionId}`, op: 'ws.message', context: { sessionId } });

  executor.on('message', (message: unknown) => {
    logger.verbose({ msg: `session.output for ${sessionId}`, op: 'ws.message', context: { sessionId } });
    client.send({ type: 'session.output', payload: { sessionId, message } });
  });

  executor.on('error', (error: string) => {
    logger.log({ msg: `session.error for ${sessionId}: ${error}`, op: 'ws.message', context: { sessionId, error } });
    client.send({ type: 'session.error', payload: { sessionId, error } });
  });

  executor.on('complete', (exitCode: number) => {
    logger.log({ msg: `session.complete for ${sessionId}: exitCode=${exitCode}`, op: 'ws.message', context: { sessionId, exitCode } });
    client.send({ type: 'session.complete', payload: { sessionId, exitCode } });
    agentStore.remove(sessionId);
  });
}
