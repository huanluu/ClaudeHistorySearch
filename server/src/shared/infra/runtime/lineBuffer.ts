/**
 * Shared JSONL line buffer for parsing streaming CLI output.
 * Used by both ClaudeRuntime and CopilotRuntime.
 */
export function createLineBuffer(onLine: (parsed: unknown) => void, onRaw?: (line: string) => void): (data: Buffer) => void {
  let buffer = '';
  return (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        try {
          onLine(JSON.parse(trimmed));
        } catch {
          onRaw?.(trimmed);
        }
      }
    }
  };
}
