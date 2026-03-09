export interface AssistantEvent {
  type: 'delta' | 'complete' | 'error';
  text?: string;
  error?: string;
  sessionId?: string;
}

export interface AssistantRunOptions {
  conversationId: string;
  resumeSessionId?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
}

export interface AssistantBackend {
  run(prompt: string, options: AssistantRunOptions): AsyncIterable<AssistantEvent>;
}
