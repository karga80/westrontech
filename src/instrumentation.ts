export async function register() {
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
