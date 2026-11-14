// Prerequisites between items as the pages see them (src/lib/deps.ts): what
// an item waits for, loops, which items the detail offers, and what moving
// items to another project breaks. Go checks the same rules on save
// (internal/store/deps_test.go).

import { expect, test } from "bun:test";
import type { Item, ItemStatus } from "../src/mygo";
import { brokenByMove, depCandidates, depIndex, depProblem, waitingFor, wouldLoop } from "../src/lib/deps";

let order = 0;
function item(id: number, status: ItemStatus = "todo", parentId = 0): Item {
  return {
    id,
    projectId: 1,
    parentId,
    moduleId: 0,
    type: "improve",
    status,
    title: `#${id}`,
    note: "",
    deeplink: "",
    sortOrder: ++order,
    createdAt: id,
    startedAt: status === "doing" ? 1 : 0,
    doneAt: status === "done" ? 1 : 0,
    doneWith: 0,
    updatedAt: id,
  };
}
const dep = (fromId: number, toId: number) => ({ fromId, toId });

test("waitingFor lists the prerequisites not done, while the item is not done", () => {
  const items = [item(1, "done"), item(2, "doing"), item(3), item(4, "done")];
  const byId = new Map(items.map((i) => [i.id, i]));
  const index = depIndex([dep(1, 3), dep(2, 3), dep(2, 4)]);
  expect(waitingFor(items[2]!, byId, index).map((i) => i.id)).toEqual([2]);
  // Done itself: it waits for nothing any more.
  expect(waitingFor(items[3]!, byId, index)).toEqual([]);
  expect(waitingFor(items[0]!, byId, index)).toEqual([]);
});

test("wouldLoop finds loops through any number of prerequisites", () => {
  const deps = [dep(1, 2), dep(2, 3), dep(3, 4)];
  expect(wouldLoop(deps, 4, 1)).toBe(true);
  expect(wouldLoop(deps, 3, 2)).toBe(true);
  expect(wouldLoop(deps, 1, 4)).toBe(false);
  expect(wouldLoop(deps, 2, 2)).toBe(true);
  expect(wouldLoop([], 1, 2)).toBe(false);
});

test("depProblem says why a prerequisite cannot be", () => {
  const items = [item(1), item(2), item(3), item(4, "todo", 3)];
  const deps = [dep(1, 2)];
  // "before": id (first) would wait for other (second).
  expect(depProblem(items, deps, 2, 1, "before")).toBe("已经是了");
  expect(depProblem(items, deps, 1, 2, "before")).toBe("会形成循环");
  expect(depProblem(items, deps, 3, 3, "before")).toBe("不能是同一条");
  expect(depProblem(items, deps, 4, 3, "before")).toBe("是上级或子改进点");
  expect(depProblem(items, deps, 3, 4, "after")).toBe("是上级或子改进点");
  expect(depProblem(items, deps, 4, 1, "before")).toBe("");
  expect(depProblem(items, deps, 1, 3, "after")).toBe("");
});

test("depCandidates offers the items allowed, not done first", () => {
  order = 0;
  const items = [item(1, "done"), item(2), item(3), item(4), item(5, "todo", 4)];
  const deps = [dep(2, 3)];
  // Before 3: not itself, not 2 (there already), not those waiting for 3.
  expect(depCandidates(items, deps, 3, "before").map((i) => i.id)).toEqual([4, 5, 1]);
  // After 2: not 3 (there already); 1 is done, last.
  expect(depCandidates(items, deps, 2, "after").map((i) => i.id)).toEqual([4, 5, 1]);
  // After 3: not 2, which 3 waits for (a loop).
  expect(depCandidates(items, deps, 3, "after").map((i) => i.id)).toEqual([4, 5, 1]);
  // Not the items above or under it.
  expect(depCandidates(items, deps, 4, "before").map((i) => i.id)).toEqual([2, 3, 1]);
});

test("brokenByMove counts the prerequisites with one end moved", () => {
  const deps = [dep(1, 2), dep(2, 3), dep(4, 5)];
  expect(brokenByMove(deps, new Set([2]))).toBe(2);
  expect(brokenByMove(deps, new Set([1, 2]))).toBe(1);
  expect(brokenByMove(deps, new Set([4, 5]))).toBe(0);
});
