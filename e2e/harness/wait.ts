export async function waitForValue<T>(input: {
  timeoutMs: number;
  intervalMs: number;
  getValue: () => Promise<T>;
  isReady: (value: T) => boolean;
  onPoll?: (info: { attempt: number; elapsedMs: number; value: T }) => void;
}): Promise<T> {
  const startedAt = Date.now();
  let attempt = 0;
  while (true) {
    attempt += 1;
    const value = await input.getValue();
    input.onPoll?.({ attempt, elapsedMs: Date.now() - startedAt, value });
    if (input.isReady(value)) return value;
    if (Date.now() - startedAt > input.timeoutMs) {
      throw new Error(`Timeout after ${input.timeoutMs}ms`);
    }
    await Bun.sleep(input.intervalMs);
  }
}
