import { test, expect } from "bun:test";
import { createBackHandler } from "@/components/AndroidBackHandler";

function harness(over: Partial<Record<string, any>> = {}) {
  const calls: string[] = [];
  let t = 0;
  const h = createBackHandler({
    closeOverlay: () => { if (over.overlay) { calls.push("closeOverlay"); return true; } return false; },
    consumeIntent: () => { if (over.intent) { calls.push("intent"); return true; } return false; },
    canGoBack: () => !!over.canGoBack,
    goBack: () => calls.push("goBack"),
    exitApp: () => calls.push("exitApp"),
    notifyExitHint: () => calls.push("hint"),
    now: () => t,
  });
  return { h, calls, tick: (ms: number) => { t += ms; } };
}

test("1. overlay open wins over everything", () => {
  const { h, calls } = harness({ overlay: true, intent: true, canGoBack: true });
  h();
  expect(calls).toEqual(["closeOverlay"]);
});

test("2+3. back-intent (wizard step / dirty form) beats history", () => {
  const { h, calls } = harness({ intent: true, canGoBack: true });
  h();
  expect(calls).toEqual(["intent"]);
});

test("4. falls through to router history", () => {
  const { h, calls } = harness({ canGoBack: true });
  h();
  expect(calls).toEqual(["goBack"]);
});

test("5a. landing route: first press hints, does not exit", () => {
  const { h, calls } = harness({});
  h();
  expect(calls).toEqual(["hint"]);
});

test("5b. second press within 2s exits", () => {
  const { h, calls, tick } = harness({});
  h(); tick(900); h();
  expect(calls).toEqual(["hint", "exitApp"]);
});

test("5c. second press after 2s re-hints instead of exiting", () => {
  const { h, calls, tick } = harness({});
  h(); tick(2500); h();
  expect(calls).toEqual(["hint", "hint"]);
});
