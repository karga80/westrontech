// Node-only crash instrumentation. Imported dynamically from instrumentation.ts
// ONLY when NEXT_RUNTIME === 'nodejs', so Turbopack never bundles `process.on`
// into the Edge build (which would emit an unsupported-API warning).
export {}; // mark as a module (side-effect-only import)
process.on('uncaughtException', (err) => {
  console.error('STACK TRACE:', err.stack);
});
process.on('unhandledRejection', (reason: unknown) => {
  if (reason instanceof Error) {
    console.error('REJECTION STACK:', reason.stack);
  } else {
    console.error('REJECTION:', reason);
  }
});
