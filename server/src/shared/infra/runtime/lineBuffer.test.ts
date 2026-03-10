import { createLineBuffer } from './lineBuffer';

describe('createLineBuffer', () => {
  it('parses a complete JSON line and calls onLine', () => {
    const onLine = vi.fn();
    const handler = createLineBuffer(onLine);

    handler(Buffer.from('{"type":"init"}\n'));

    expect(onLine).toHaveBeenCalledWith({ type: 'init' });
  });

  it('buffers incomplete lines across multiple chunks', () => {
    const onLine = vi.fn();
    const handler = createLineBuffer(onLine);

    handler(Buffer.from('{"type":'));
    expect(onLine).not.toHaveBeenCalled();

    handler(Buffer.from('"done"}\n'));
    expect(onLine).toHaveBeenCalledWith({ type: 'done' });
  });

  it('handles multiple lines in a single chunk', () => {
    const onLine = vi.fn();
    const handler = createLineBuffer(onLine);

    handler(Buffer.from('{"a":1}\n{"b":2}\n'));

    expect(onLine).toHaveBeenCalledTimes(2);
    expect(onLine).toHaveBeenNthCalledWith(1, { a: 1 });
    expect(onLine).toHaveBeenNthCalledWith(2, { b: 2 });
  });

  it('calls onRaw for non-JSON lines when provided', () => {
    const onLine = vi.fn();
    const onRaw = vi.fn();
    const handler = createLineBuffer(onLine, onRaw);

    handler(Buffer.from('not json\n'));

    expect(onLine).not.toHaveBeenCalled();
    expect(onRaw).toHaveBeenCalledWith('not json');
  });

  it('silently skips non-JSON lines when onRaw is not provided', () => {
    const onLine = vi.fn();
    const handler = createLineBuffer(onLine);

    handler(Buffer.from('not json\n'));

    expect(onLine).not.toHaveBeenCalled();
  });

  it('ignores empty and whitespace-only lines', () => {
    const onLine = vi.fn();
    const onRaw = vi.fn();
    const handler = createLineBuffer(onLine, onRaw);

    handler(Buffer.from('\n  \n\n'));

    expect(onLine).not.toHaveBeenCalled();
    expect(onRaw).not.toHaveBeenCalled();
  });
});
