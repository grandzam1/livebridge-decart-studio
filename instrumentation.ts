// Runs once when the Next.js server starts. Prints the LiveBridge config checklist; never blocks startup.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { logConfigChecklist } = await import("./lib/config");
    logConfigChecklist();
  } catch (error) {
    console.error(`LiveBridge config check failed:\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}
