export function current_phase(): "prerequest" | "test" {
  const event = pm.info?.eventName;
  if (event === "prerequest" || event === "test") return event;
  if (event !== undefined) {
    throw new Error(
      "MAGIC_ERROR: only HTTP prerequest/test events are supported",
    );
  }
  return pm.response ? "test" : "prerequest";
}
