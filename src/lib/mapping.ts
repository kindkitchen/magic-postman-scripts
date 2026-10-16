import { deep_merge, is_record } from "../helpers/deep_merge";
import { convert_value, previous_container, serialize_value } from "./values";

const types = ["string", "number", "boolean", "object", "array"];
const strategies = ["replace", "propose", "merge", "deep-merge"];

export function mapping(
  configuration: Mapping | undefined,
  source: unknown,
  destination: VarScopeName,
  prefix = "",
): void {
  if (configuration === undefined) return;
  if (!is_record(configuration)) throw new Error("Mapping must be an object");
  const errors: string[] = [];

  for (const [name, definition] of Object.entries(configuration)) {
    const key = prefix + name;
    let path: PathSegment[] = [];
    let stage = "validate mapping configuration";
    try {
      if (!Array.isArray(definition)) throw new Error();
      const parts = [...definition];
      const last = parts[parts.length - 1];
      const supplied = is_record(last) ? (parts.pop() as MayBeOptions) : {};
      if (
        !parts.every(
          (part) =>
            typeof part === "string" ||
            (typeof part === "number" && Number.isInteger(part) && part >= 0),
        )
      )
        throw new Error();
      path = parts as PathSegment[];
      const options = {
        type: supplied.type ?? "string",
        strategy: supplied.strategy ?? "replace",
        magic: supplied.magic ?? null,
        on_missing: supplied.on_missing ?? "error",
      };
      if (
        !types.includes(options.type) ||
        !strategies.includes(options.strategy) ||
        !["error", "skip"].includes(options.on_missing) ||
        (options.magic !== null && typeof options.magic !== "string")
      )
        throw new Error();

      const scope = pm[destination];
      stage = "read existing variable";
      const previous = scope.get(key);
      const exists = scope.has
        ? scope.has(key)
        : previous !== undefined && previous !== null;
      if (options.strategy === "propose" && exists) {
        if (magic.debug)
          console.info(`MAGIC: keep ${destination}.${key} (propose)`);
        continue;
      }

      stage = "read path";
      let value = source;
      let missing = value === undefined;
      for (const part of path) {
        if (
          value === null ||
          value === undefined ||
          !Object.prototype.hasOwnProperty.call(value, part)
        ) {
          missing = true;
          break;
        }
        value = (value as Record<PathSegment, unknown>)[part];
        if (value === undefined) missing = true;
      }
      if (missing) {
        if (options.on_missing === "skip") {
          if (magic.debug)
            console.info(`MAGIC: skip ${destination}.${key} (missing path)`);
          continue;
        }
        stage = "read missing path";
        throw new Error();
      }

      if (options.magic !== null) {
        stage = "transform value (expected a synchronous function expression)";
        // Backward-compatible trusted-code extension point. Never log code or values.
        const transform: unknown = eval(`(${options.magic})`);
        if (
          typeof transform !== "function" ||
          Object.prototype.toString.call(transform) === "[object AsyncFunction]"
        )
          throw new Error();
        value = transform(value);
        if (
          value !== null &&
          (typeof value === "object" || typeof value === "function") &&
          typeof (value as { then?: unknown }).then === "function"
        ) {
          // Reject async results, but consume rejected promises to avoid unhandled rejections.
          void Promise.resolve(value).catch(() => {});
          throw new Error();
        }
      }

      stage = `convert value to ${options.type} (expected JSON-compatible data)`;
      value = convert_value(value, options.type);

      if (
        (options.strategy === "merge" || options.strategy === "deep-merge") &&
        (options.type === "object" || options.type === "array") &&
        exists
      ) {
        stage = "merge values";
        const oldValue = previous_container(previous, options.type);
        if (oldValue !== undefined) {
          if (options.strategy === "deep-merge") {
            value = deep_merge(oldValue, value);
          } else {
            value =
              options.type === "array"
                ? [...(oldValue as unknown[]), ...(value as unknown[])]
                : { ...(oldValue as object), ...(value as object) };
          }
        }
      }

      stage = "save variable";
      scope.set(key, serialize_value(value));
      if (magic.debug) {
        console.info(
          `MAGIC: set ${destination}.${key} (${options.type}, ${options.strategy})`,
        );
      }
    } catch {
      // Never include arbitrary exception text: it can contain tokens/body contents.
      errors.push(
        `${destination}.${key} at ${JSON.stringify(path)}: unable to ${stage}`,
      );
    }
  }
  if (errors.length) throw new Error("MAGIC_ERROR: " + errors.join("; "));
}
