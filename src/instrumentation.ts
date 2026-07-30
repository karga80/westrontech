export async function register() {
  // `process.on` only exists in the Node.js runtime. Next.js also evaluates
  // instrumentation in the Edge runtime, where these APIs are unavailable and
  // would log a warning — so guard on the runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

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
}
