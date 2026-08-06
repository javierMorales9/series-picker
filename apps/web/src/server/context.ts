import "@tanstack/react-start/server-only";
import { bootstrap } from "../../../shared/bootstrap.ts";

const key = Symbol.for("series-raqui.web-context");
type Context = ReturnType<typeof bootstrap>;
const globals = globalThis as typeof globalThis & { [key]?: Context };

export function getContext(): Context {
  const existing = globals[key];
  if (existing) return existing;
  const context = bootstrap();
  // globals[key] = context;
  return context;
}
