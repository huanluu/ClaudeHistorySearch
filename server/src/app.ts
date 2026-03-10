import Bonjour from 'bonjour-service';
import { execSync } from 'child_process';
import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createDatabase, createSessionRepository, createHeartbeatRepository, createCronRepository, DB_PATH } from './shared/infra/database/index';
import { NodeFileSystem } from './shared/infra/filesystem/index';
import { authMiddleware, hasApiKey, WorkingDirValidator, createLogger, LOG_PATH, ErrorRingBuffer, createRequestLogger, type RequestLogLevel, type RequestLoggerOptions, type SessionSource } from './shared/provider/index';
import { HttpTransport, WebSocketGateway, validateQuery, validateBody, SearchQuerySchema, SessionsQuerySchema, ConfigUpdateBodySchema } from './gateway/index';
import type { AuthenticatedClient } from './gateway/index';
import { AgentStore, registerLiveHandlers } from './features/live/index';
import { AssistantService, registerAssistantHandlers } from './features/assistant/index';
import { SdkAssistantBackend, createCronMcpTools } from './shared/infra/assistant/index';
import { ClaudeRuntime, CopilotRuntime, createNodeCommandExecutor } from './shared/infra/runtime/index';
import type { CliRuntime } from './shared/provider/index';
import { indexAllSessions, FileWatcher, registerSearchRoutes } from './features/search/index';
import { ClaudeSessionSource, CopilotSessionSource } from './shared/infra/parsers/index';
import { HeartbeatService, type HeartbeatConfig, registerSchedulerRoutes } from './features/scheduler/index';
import { CronService, registerCronRoutes } from './features/cron/index';
import { ConfigService, DiagnosticsService, registerAdminRoutes } from './features/admin/index';

export interface AppConfig {
  port: number;
  serviceType?: string;
  dbPath?: string;
  logPath?: string;
  skipBonjour?: boolean;
  sessionSources?: SessionSource[];
}

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPort(): number;
  getHttpTransport(): HttpTransport;
}

/**
 * Check if macOS firewall stealth mode is enabled (blocks Bonjour discovery)
 */
function isStealthModeEnabled(): boolean {
  try {
    const output = execSync('/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output.includes('stealth mode is on');
  } catch {
    return false;
  }
}

/**
 * Resolve heartbeat env var overrides (SEC-INV-5: env reads confined to app.ts)
 */
function resolveHeartbeatEnvOverrides(): Partial<HeartbeatConfig> {
  const overrides: Partial<HeartbeatConfig> = {};
  if (process.env.HEARTBEAT_ENABLED !== undefined) {
    overrides.enabled = process.env.HEARTBEAT_ENABLED !== 'false';
  }
  if (process.env.HEARTBEAT_INTERVAL_MS !== undefined) {
    const parsed = parseInt(process.env.HEARTBEAT_INTERVAL_MS, 10);
    if (!isNaN(parsed)) overrides.intervalMs = parsed;
  }
  if (process.env.HEARTBEAT_WORKING_DIR !== undefined) {
    overrides.workingDirectory = process.env.HEARTBEAT_WORKING_DIR;
  }
  if (process.env.HEARTBEAT_MAX_ITEMS !== undefined) {
    const parsed = parseInt(process.env.HEARTBEAT_MAX_ITEMS, 10);
    if (!isNaN(parsed)) overrides.maxItems = parsed;
  }
  if (process.env.HEARTBEAT_MAX_RUNS !== undefined) {
    const parsed = parseInt(process.env.HEARTBEAT_MAX_RUNS, 10);
    if (!isNaN(parsed)) overrides.maxRuns = parsed;
  }
  return overrides;
}

// Shared mutable state for lifecycle functions
interface AppContext {
  config: AppConfig;
  serviceType: string;
  dbPath: string;
  logger: ReturnType<typeof createLogger>;
  sessionRepo: ReturnType<typeof createSessionRepository>;
  sessionSources: SessionSource[];
  fs: NodeFileSystem;
  transport: HttpTransport;
  fileWatcher: FileWatcher;
  agentStore: AgentStore;
  diagnosticsService: DiagnosticsService;
  heartbeatService: HeartbeatService;
  cronService: CronService;
  cronMcpServer: ReturnType<typeof createCronMcpTools>;
  claudeRuntime: ClaudeRuntime;
  workingDirValidator: WorkingDirValidator;
  allowedDirs: string[];
  wsGateway: WebSocketGateway | null;
  bonjour: Bonjour | null;
  bonjourService: ReturnType<Bonjour['publish']> | null;
  reindexTimer: NodeJS.Timeout | null;
}

function initializeWebSocketGateway(ctx: AppContext): void {
  const httpServer = ctx.transport.getServer();
  if (!httpServer) return;

  const gw = new WebSocketGateway({ server: httpServer, path: '/ws', pingInterval: 30000, logger: ctx.logger });
  ctx.wsGateway = gw;

  registerLiveHandlers(gw, { agentStore: ctx.agentStore, validator: ctx.workingDirValidator, logger: ctx.logger });

  const assistantBackend = new SdkAssistantBackend(ctx.logger, {
    cron: ctx.cronMcpServer,
    'work-iq': { command: '/opt/homebrew/bin/node', args: ['/opt/homebrew/bin/workiq', 'mcp'] },
  });
  const assistantService = new AssistantService(assistantBackend, ctx.logger);
  registerAssistantHandlers(gw, { assistantService, logger: ctx.logger });

  gw.onConnect((client: AuthenticatedClient) => {
    ctx.logger.log({ msg: `Client connected: ${client.clientId} (${gw.getClientCount()} total)`, op: 'ws.connect', context: { clientId: client.clientId, total: gw.getClientCount() } });
  });
  gw.onDisconnect((client: AuthenticatedClient) => {
    ctx.logger.log({ msg: `Client disconnected: ${client.clientId} (${gw.getClientCount()} total)`, op: 'ws.disconnect', context: { clientId: client.clientId, total: gw.getClientCount() } });
  });
  gw.on('message', (client, payload, id) => {
    ctx.logger.log({ msg: `Message from ${client.clientId}`, op: 'ws.message', context: { clientId: client.clientId } });
    client.send({ type: 'message', payload: { echo: payload }, id });
  });

  gw.start();
  ctx.logger.log({ msg: `WebSocket server available at ws://0.0.0.0:${ctx.transport.getPort()}/ws`, op: 'server.start' });
}

function publishBonjourService(ctx: AppContext): void {
  if (ctx.config.skipBonjour) {
    ctx.logger.log({ msg: 'Bonjour advertisement skipped (skipBonjour option)', op: 'server.start' });
    return;
  }
  if (isStealthModeEnabled()) {
    ctx.logger.log({ msg: 'Bonjour advertisement disabled (firewall stealth mode is on)', op: 'server.start' });
    return;
  }
  const boundPort = ctx.transport.getPort();
  ctx.bonjour = new Bonjour();
  ctx.bonjourService = ctx.bonjour.publish({ name: 'Claude History Server', type: ctx.serviceType, port: boundPort, txt: { version: '1.0.0' } });
  ctx.logger.log({ msg: `Bonjour service advertised as _${ctx.serviceType}._tcp on port ${boundPort}`, op: 'server.start', context: { serviceType: ctx.serviceType, port: boundPort } });
}

function setupPeriodicReindex(ctx: AppContext): void {
  const REINDEX_INTERVAL = 5 * 60 * 1000;
  ctx.reindexTimer = setInterval(async () => {
    ctx.logger.log({ msg: 'Running periodic reindex...', op: 'server.reindex' });
    const result = await indexAllSessions(false, ctx.sessionRepo, ctx.logger, ctx.sessionSources, ctx.fs);
    ctx.diagnosticsService.setLastIndexResult(result);
    ctx.logger.log({ msg: result.indexed > 0 ? `Periodic reindex: ${result.indexed} new sessions indexed` : 'Periodic reindex: no new sessions', op: 'server.reindex' });
  }, REINDEX_INTERVAL);
  ctx.logger.log({ msg: `Periodic reindex scheduled every ${REINDEX_INTERVAL / 1000 / 60} minutes`, op: 'server.start', context: { intervalMinutes: REINDEX_INTERVAL / 1000 / 60 } });
}

function wireHttpRoutes(ctx: AppContext, configService: ConfigService, onConfigChanged: (s: string) => void): void {
  const validationRouter = Router();
  validationRouter.get('/search', validateQuery(SearchQuerySchema));
  validationRouter.get('/sessions', validateQuery(SessionsQuerySchema));
  validationRouter.put('/api/config/:section', validateBody(ConfigUpdateBodySchema));
  ctx.transport.use('/', validationRouter);

  const router = Router();
  registerSearchRoutes(router, {
    repo: ctx.sessionRepo, logger: ctx.logger,
    indexFn: (force, repo, logger) => indexAllSessions(force, repo, logger, ctx.sessionSources, ctx.fs),
  });
  registerSchedulerRoutes(router, { heartbeatService: ctx.heartbeatService, logger: ctx.logger });
  registerCronRoutes(router, { cronService: ctx.cronService, logger: ctx.logger });

  const __filename = fileURLToPath(import.meta.url);
  const adminHtmlPath = join(dirname(__filename), 'features', 'admin', 'admin.html');
  const adminHtml = ctx.fs.exists(adminHtmlPath) ? ctx.fs.readFile(adminHtmlPath) : undefined;
  registerAdminRoutes(router, { diagnosticsService: ctx.diagnosticsService, configService, onConfigChanged, logger: ctx.logger, adminHtml });
  ctx.transport.use('/', router);
}

async function startApp(ctx: AppContext): Promise<void> {
  if (ctx.allowedDirs.length === 0) {
    ctx.logger.log({ msg: 'WARNING: No allowed working directories configured. All session.start/resume requests will be denied.', op: 'server.start' });
    ctx.logger.log({ msg: 'Configure allowed directories via the admin UI at /admin', op: 'server.start' });
  } else {
    ctx.logger.log({ msg: `Security: ${ctx.allowedDirs.length} allowed working director${ctx.allowedDirs.length === 1 ? 'y' : 'ies'} configured`, op: 'server.start', context: { allowedDirs: ctx.allowedDirs.length } });
  }

  await ctx.transport.start();
  const boundPort = ctx.transport.getPort();
  ctx.logger.log({ msg: `Claude History Server running on http://0.0.0.0:${boundPort}`, op: 'server.start', context: { port: boundPort } });
  ctx.logger.log({ msg: `Database: ${ctx.dbPath}`, op: 'server.start', context: { dbPath: ctx.dbPath } });

  initializeWebSocketGateway(ctx);

  ctx.logger.log({ msg: hasApiKey() ? 'Authentication: API key required' : 'Authentication: No API key configured (run "npm run key:generate" to secure the server)', op: 'server.start' });

  ctx.logger.log({ msg: 'Starting initial index...', op: 'server.start' });
  const result = await indexAllSessions(false, ctx.sessionRepo, ctx.logger, ctx.sessionSources, ctx.fs);
  ctx.diagnosticsService.setLastIndexResult(result);
  ctx.logger.log({ msg: `Initial index complete: ${result.indexed} sessions indexed`, op: 'server.start', context: { indexed: result.indexed } });

  publishBonjourService(ctx);
  ctx.fileWatcher.start();
  setupPeriodicReindex(ctx);

  const heartbeatConfig = ctx.heartbeatService.getConfig();
  if (heartbeatConfig.enabled) {
    ctx.heartbeatService.startScheduler();
    ctx.logger.log({ msg: `Heartbeat working directory: ${heartbeatConfig.workingDirectory}`, op: 'server.start', context: { workingDirectory: heartbeatConfig.workingDirectory } });
  } else {
    ctx.logger.log({ msg: 'Heartbeat: disabled', op: 'server.start' });
  }

  ctx.cronService.startScheduler();
  const cronJobs = ctx.cronService.listJobs();
  ctx.logger.log({ msg: `Cron scheduler started: ${cronJobs.length} job${cronJobs.length === 1 ? '' : 's'}`, op: 'server.start', context: { jobCount: cronJobs.length } });
}

async function stopApp(ctx: AppContext): Promise<void> {
  ctx.logger.log({ msg: 'Shutting down...', op: 'server.stop' });
  ctx.claudeRuntime.cleanup();
  if (ctx.reindexTimer) { clearInterval(ctx.reindexTimer); ctx.reindexTimer = null; }
  ctx.heartbeatService.stopScheduler();
  await ctx.cronService.stopScheduler();
  ctx.bonjourService?.stop?.();
  ctx.bonjour?.destroy();
  await ctx.fileWatcher.stop();
  await ctx.wsGateway?.stop();
  await ctx.transport.stop();
  ctx.logger.log({ msg: 'Server stopped', op: 'server.stop' });
}

/**
 * Composition root: wires all services together and returns an App.
 */
export function createApp(config: AppConfig): App {
  const { port, serviceType = 'claudehistory' } = config;
  const dbPath = config.dbPath ?? DB_PATH;
  const logPath = config.logPath ?? LOG_PATH;

  const errorBuffer = new ErrorRingBuffer(50);
  const logger = createLogger(logPath, { errorBuffer });
  const db = createDatabase(dbPath, logger);
  const sessionRepo = createSessionRepository(db);
  const heartbeatRepo = createHeartbeatRepository(db);
  const cronRepo = createCronRepository(db);
  const fs = new NodeFileSystem();

  const configService = new ConfigService(fs);
  const securityConfig = configService.getSection('security') as { allowedWorkingDirs?: string[] } | null;
  const allowedDirs = securityConfig?.allowedWorkingDirs ?? [];
  const workingDirValidator = new WorkingDirValidator(allowedDirs);
  const claudeRuntime = new ClaudeRuntime(process.env);
  const copilotRuntime = new CopilotRuntime(process.env);
  const runtimes = new Map<string, CliRuntime>([[claudeRuntime.name, claudeRuntime], [copilotRuntime.name, copilotRuntime]]);

  const commandExecutor = createNodeCommandExecutor();
  const heartbeatService = new HeartbeatService(fs, commandExecutor, undefined, heartbeatRepo, logger, claudeRuntime, resolveHeartbeatEnvOverrides());
  const cronService = new CronService(cronRepo, (opts) => claudeRuntime.runHeadless(opts, logger), logger);
  const cronMcpServer = createCronMcpTools(cronService);

  const sessionSources = config.sessionSources ?? [new ClaudeSessionSource(), new CopilotSessionSource()];
  const fileWatcher = new FileWatcher(sessionSources, sessionRepo, logger, fs);
  const agentStore = new AgentStore(logger, (id, source, log) => (runtimes.get(source) ?? claudeRuntime).startSession(id, log));

  const diagnosticsService = new DiagnosticsService({
    repo: sessionRepo, errorBuffer, fileWatcher, heartbeatService,
    getWsClientCount: () => ctx.wsGateway?.getClientCount() ?? 0, // deferred closure — ctx assigned below before any call
    getActiveSessionCount: () => agentStore.getAll().length,
    startedAt: new Date(), dbPath,
  });

  const loggingConfig = configService.getSection('logging') as { requestLogLevel?: string } | null;
  const requestLoggerOptions: RequestLoggerOptions = { level: (loggingConfig?.requestLogLevel as RequestLogLevel) ?? 'all', logger };
  const transport = new HttpTransport({ port });
  transport.use(createRequestLogger(requestLoggerOptions));
  transport.use(authMiddleware);

  const onConfigChanged = (section: string): void => {
    if (section === 'heartbeat') {
      const s = configService.getSection('heartbeat');
      if (s) heartbeatService.updateConfig(s as Partial<HeartbeatConfig>);
      heartbeatService.startScheduler();
    }
    if (section === 'logging') {
      const s = configService.getSection('logging') as { requestLogLevel?: string } | null;
      requestLoggerOptions.level = (s?.requestLogLevel as RequestLogLevel) ?? 'all';
      logger.log({ msg: `Request log level updated: ${requestLoggerOptions.level}`, op: 'server.config' });
    }
    if (section === 'security') {
      const s = configService.getSection('security') as { allowedWorkingDirs?: string[] } | null;
      const dirs = s?.allowedWorkingDirs ?? [];
      workingDirValidator.setAllowedDirs(dirs);
      logger.log({ msg: `Security config updated: ${dirs.length} allowed dirs`, op: 'server.config' });
    }
  };

  const ctx: AppContext = {
    config, serviceType, dbPath, logger, sessionRepo, sessionSources, fs, transport,
    fileWatcher, agentStore, diagnosticsService, heartbeatService, cronService, cronMcpServer,
    claudeRuntime, workingDirValidator, allowedDirs,
    wsGateway: null, bonjour: null, bonjourService: null, reindexTimer: null,
  };

  wireHttpRoutes(ctx, configService, onConfigChanged);

  return {
    start: () => startApp(ctx),
    stop: () => stopApp(ctx),
    getPort: () => transport.getPort(),
    getHttpTransport: () => transport,
  };
}
