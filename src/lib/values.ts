import { clone_value, is_record } from "../helpers/deep_merge";

export function convert_value(value: unknown, type: VarConvertType): unknown {
  if (type === "string") {
    return typeof value === "object" && value !== null
      ? JSON.stringify(clone_value(value))
      : String(clone_value(value));
  }
  if (type === "number") {
    if (
      typeof value !== "number" &&
      !(typeof value === "string" && value.trim() !== "")
    )
      throw new Error("Expected a finite number or nonempty numeric string");
    const converted = Number(value);
    if (!Number.isFinite(converted))
      throw new Error("Expected a finite number");
    return converted;
  }
  if (type === "boolean") {
    if (value === true || value === 1 || value === "true" || value === "1")
      return true;
    if (value === false || value === 0 || value === "false" || value === "0")
      return false;
    throw new Error("Expected a boolean, 0/1, or true/false string");
  }
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("Expected valid JSON for object/array conversion");
    }
  }
  if (type === "array" ? !Array.isArray(parsed) : !is_record(parsed)) {
    throw new Error(`Expected ${type}`);
  }
  return clone_value(parsed);
}

export function previous_container(
  value: unknown,
  type: VarConvertType,
): unknown {
  try {
    return convert_value(value, type);
  } catch {
    return undefined;
  }
}

export function serialize_value(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
