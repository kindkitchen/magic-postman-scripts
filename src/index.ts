import type {} from "./types";
import { guard_before_query } from "./guard_before_query";
import { test_after_response } from "./test_after_response";
import { current_phase } from "./lib/lifecycle";

const phase = current_phase();
guard_before_query();
if (phase === "test") test_after_response();

export {};
