type Level = "debug" | "info" | "warn" | "error";
function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({ level, message, ts: new Date().toISOString(), ...meta });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}
export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => emit("debug", m, meta),
  info: (m: string, meta?: Record<string, unknown>) => emit("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => emit("error", m, meta),
};
