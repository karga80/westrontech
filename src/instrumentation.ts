export async function register() {
  // process.on only exists in the Node.js runtime. Load the Node-only handlers
  // via dynamic import so Turbopack keeps them out of the Edge bundle entirely
  // (a static `process.on` reference here would warn on every compile).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
