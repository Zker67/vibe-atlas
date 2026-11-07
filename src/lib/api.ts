import { isCallError } from "mygo-runtime";
import { toast } from "sonner";

/** The message of an error a Go call rejected with, written for the user. */
export function errorMessage(e: unknown): string {
  if (isCallError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Awaits a call and returns its value, or undefined after showing its error. */
export async function run<T>(call: Promise<T>): Promise<T | undefined> {
  try {
    return await call;
  } catch (e) {
    toast.error(errorMessage(e));
    return undefined;
  }
}

/** Awaits a call and tells whether it succeeded, showing its error if not. */
export async function runOk(call: Promise<unknown>): Promise<boolean> {
  try {
    await call;
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
}
