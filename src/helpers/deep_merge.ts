const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);

export function is_record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  // Also accepts plain objects originating in another sandbox/realm.
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/** Clone JSON-like data without preserving references or unsafe prototypes. */
export function clone_value(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone_value);
  if (is_record(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (unsafeKeys.has(key)) throw new Error("Unsafe object key");
      result[key] = clone_value(value[key]);
    }
    return result;
  }
  if (value !== null && typeof value === "object") {
    throw new Error("Expected JSON-compatible data");
  }
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint" ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    throw new Error("Expected JSON-compatible data");
  }
  return value;
}

function merge_pair(previous: unknown, incoming: unknown): unknown {
  if (Array.isArray(previous) && Array.isArray(incoming)) {
    return [...previous, ...incoming];
  }
  if (is_record(previous) && is_record(incoming)) {
    const result = { ...previous };
    for (const key of Object.keys(incoming)) {
      result[key] = Object.prototype.hasOwnProperty.call(previous, key)
        ? merge_pair(previous[key], incoming[key])
        : incoming[key];
    }
    return result;
  }
  return incoming;
}

/** Recursively merge JSON objects and concatenate arrays, preserving nesting. */
export function deep_merge(...objects: unknown[]): unknown {
  return objects.reduce<unknown>(
    (previous, incoming) => merge_pair(previous, clone_value(incoming)),
    {},
  );
}
