import type { LogLevel } from "../config.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  child(scope: string): Logger;
}

function formatMeta(meta: unknown): string {
  if (meta === undefined) {
    return "";
  }
  if (meta instanceof Error) {
    return ` ${meta.stack ?? meta.message}`;
  }
  if (typeof meta === "string") {
    return ` ${meta}`;
  }
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ` ${String(meta)}`;
  }
}

class ConsoleLogger implements Logger {
  constructor(
    private readonly level: LogLevel,
    private readonly scope?: string,
  ) {}

  debug(message: string, meta?: unknown): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.log("error", message, meta);
  }

  child(scope: string): Logger {
    return new ConsoleLogger(this.level, this.scope ? `${this.scope}:${scope}` : scope);
  }

  private log(level: LogLevel, message: string, meta?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }
    const prefix = this.scope ? `[${this.scope}]` : "[gateway]";
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${prefix} ${message}${formatMeta(meta)}`;
    if (level === "error") {
      console.error(line);
      return;
    }
    if (level === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
  }
}

export function createLogger(level: LogLevel): Logger {
  return new ConsoleLogger(level);
}
