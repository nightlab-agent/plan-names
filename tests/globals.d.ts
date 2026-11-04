// The test runner's globals, which the engine's declarations leave out.
declare const console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
declare function setTimeout(run: (value?: unknown) => void, ms?: number): unknown
