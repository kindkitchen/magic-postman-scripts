import { current_phase } from "./lib/lifecycle";

export function guard_before_query(): void {
  const patterns = magic.guard?.env_name_like;
  if (patterns === undefined) return;
  const list = Array.isArray(patterns) ? patterns : [patterns];
  let matches = false;
  let invalid = false;
  try {
    const expressions = list.map((pattern: string | RegExp) => {
      if (
        typeof pattern !== "string" &&
        Object.prototype.toString.call(pattern) !== "[object RegExp]"
      ) {
        throw new Error("Invalid pattern");
      }
      // Clone RegExp inputs so global/sticky lastIndex cannot change behavior.
      return new RegExp(pattern);
    });
    matches = expressions.some((expression) =>
      expression.test(pm.environment.name ?? ""),
    );
  } catch {
    invalid = true;
  }
  if (matches && !invalid) return;

  const reason = invalid
    ? "MAGIC_ERROR: invalid magic.guard.env_name_like pattern"
    : "MAGIC_ERROR: environment does not match magic.guard.env_name_like";
  if (current_phase() === "prerequest") {
    if (typeof pm.execution?.skipRequest !== "function") {
      throw new Error(
        reason +
          "; runtime lacks pm.execution.skipRequest(); request cancellation cannot be guaranteed",
      );
    }
    console.warn(reason);
    pm.execution.skipRequest();
  }
  throw new Error(reason);
}
