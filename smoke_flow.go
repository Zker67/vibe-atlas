package main

import (
	"errors"

	"github.com/egoist/mygo"
)

// flowChecks are the checks of smokeFlow, each true when it passed.
var flowChecks = []string{
	"detailAddsDep", "queueShowsWait", "flowLoads", "lineShows",
	"lineDrawn", "lineDeleted", "undoBringsBack", "dragSaves",
	"doubleClickCreates", "overviewReady", "backToQueue",
}

// smokeFlow checks prerequisites and the flow chart in the main window,
// with the events the pointer and the keys send: 添加前置 in the detail
// makes one, and the queue marks the item waiting; the flow chart loads
// on demand and shows the cards and the line; a line drawn from a card's
// handle to another saves a prerequisite, a line clicked and Delete takes
// it away, Ctrl+Z brings it back; dragging a card saves where it is; a
// double click on empty chart names a new item there; the overview lists
// an item whose prerequisites are done under 可以开始.
func (a *app) smokeFlow(main *mygo.Window) (map[string]any, error) {
	result, err := mygo.EvalAs[map[string]any](main.Page(), `
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const until = async (check, ms = 5000) => {
			for (let t = 0; t < ms; t += 50) {
				const v = await check();
				if (v) return true;
				await sleep(50);
			}
			return false;
		};
		const project = (await mygo.call("Atlas.Projects")).find((p) => p.name === "冒烟测试项目");
		const add = (title) => mygo.call("Atlas.CreateItem", { projectId: project.id, parentId: 0, moduleId: 0, type: "feature", title });
		const first = await add("前置测试甲");
		const second = await add("前置测试乙");
		const third = await add("前置测试丙");
		const deps = () => mygo.call("Atlas.Deps", project.id);
		const has = async (from, to) => (await deps()).some((d) => d.fromId === from && d.toId === to);
		const rows = () => [...document.querySelectorAll("[data-queue-row]")];
		const row = (title) => rows().find((el) => el.textContent.includes(title));
		const click = (el, opts = {}) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...opts }));
		const key = (k, opts = {}, target = document.body) =>
			target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }));
		const center = (el) => {
			const r = el.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		};
		const pointer = (type, target, at, opts = {}) =>
			target.dispatchEvent(new PointerEvent(type, {
				bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true,
				button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: at.x, clientY: at.y, ...opts,
			}));
		const overlay = () => document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
		for (let i = 0; i < 5 && overlay(); i++) {
			overlay().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
			await until(() => !overlay(), 600);
		}
		if (overlay()) return { error: "an overlay stays open: " + overlay().getAttribute("role") };
		document.activeElement?.blur?.();

		const out = {};
		if (!(await until(() => row("前置测试乙")))) return { error: "the rows did not show" };
		click(row("前置测试乙"));
		const addBefore = () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "添加前置");
		if (!(await until(() => !!addBefore()))) return { error: "the detail has no 添加前置" };
		addBefore().click();
		const option = () => [...document.querySelectorAll("[cmdk-item]")].find((el) => el.textContent.includes("前置测试甲"));
		if (!(await until(() => !!option()))) return { error: "添加前置 does not list the item" };
		click(option());
		out.detailAddsDep = await until(() => has(first.id, second.id));
		await until(() => !overlay(), 1000);
		out.queueShowsWait = await until(() => !!row("前置测试乙")?.querySelector('[aria-label^="在等 1 条前置"]'));

		const viewButton = (label) => document.querySelector('[role="radio"][aria-label="' + label + '"], button[aria-label="' + label + '"]');
		click(viewButton("流程图"));
		const node = (id) => document.querySelector('[data-flow-node][data-id="' + id + '"]');
		out.flowLoads = await until(() => !!node(first.id) && !!node(second.id) && !!node(third.id), 8000);
		const edge = (from, to) => document.querySelector('[data-flow-edge="' + from + ">" + to + '"]');
		out.lineShows = await until(() => !!edge(first.id, second.id));
		const board = document.querySelector(".flow-board");
		if (!board) return { ...out, error: "no board" };

		// From the right handle of 丙 to the card of 乙: 乙 waits for 丙.
		await sleep(100);
		const port = node(third.id).querySelector('[data-flow-port="out"]');
		const to = center(node(second.id));
		pointer("pointerdown", port, center(port));
		pointer("pointermove", window, { x: to.x - 20, y: to.y });
		pointer("pointermove", window, to);
		pointer("pointerup", window, to);
		out.lineDrawn = await until(() => has(third.id, second.id));

		await until(() => !!edge(third.id, second.id));
		const line = edge(third.id, second.id).querySelector("path");
		pointer("pointerdown", line, center(line));
		pointer("pointerup", window, center(line));
		await sleep(100);
		key("Delete");
		out.lineDeleted = await until(async () => !(await has(third.id, second.id)));
		await sleep(200);
		key("z", { ctrlKey: true });
		out.undoBringsBack = await until(() => has(third.id, second.id));

		// Drag 甲 by 96 pixels to the right.
		const before = center(node(first.id));
		const title = node(first.id).querySelector(".line-clamp-2");
		pointer("pointerdown", title, before);
		pointer("pointermove", window, { x: before.x + 40, y: before.y });
		pointer("pointermove", window, { x: before.x + 96, y: before.y });
		pointer("pointerup", window, { x: before.x + 96, y: before.y });
		out.dragSaves = await until(async () => {
			const spots = await mygo.call("Atlas.Canvas", project.id);
			const at = spots.find((s) => s.itemId === first.id);
			// The others shown were saved where they were, too.
			return !!at && spots.some((s) => s.itemId === second.id) && Math.abs(center(node(first.id)).x - before.x - 96) < 12;
		});

		// A double click on empty chart, near the top left corner.
		const r = board.getBoundingClientRect();
		const spot = [{ x: r.left + 12, y: r.top + 12 }, { x: r.left + 12, y: r.bottom - 12 }, { x: r.right - 200, y: r.top + 12 }]
			.find((p) => document.elementFromPoint(p.x, p.y) === board);
		if (spot) {
			board.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: spot.x, clientY: spot.y }));
			const field = () => document.querySelector('input[aria-label="新改进点的标题"]');
			if (await until(() => !!field())) {
				const input = field();
				Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "画布上新建的一条");
				input.dispatchEvent(new Event("input", { bubbles: true }));
				key("Enter", {}, input);
				out.doubleClickCreates = await until(async () => {
					const items = await mygo.call("Atlas.Items", project.id);
					const made = items.find((i) => i.title === "画布上新建的一条");
					if (!made) return false;
					const spots = await mygo.call("Atlas.Canvas", project.id);
					return spots.some((s) => s.itemId === made.id) && !field();
				});
			}
		} else {
			out.doubleClickCreates = "no empty spot";
		}

		await mygo.call("Atlas.SetItemStatus", first.id, "done");
		await mygo.call("Atlas.SetItemStatus", third.id, "done");
		click(viewButton("总览"));
		out.overviewReady = await until(() =>
			[...document.querySelectorAll("section")].some((s) => s.textContent.includes("可以开始") && s.textContent.includes("前置测试乙")),
		);
		click(viewButton("队列"));
		out.backToQueue = await until(() => !!row("前置测试乙"));
		key("Escape");
		return out;
	`)
	if err != nil {
		return nil, err
	}
	if msg, ok := result["error"].(string); ok {
		return result, errors.New(msg)
	}
	for _, k := range flowChecks {
		if result[k] != true {
			return result, errors.New("flow: " + k + " failed: " + jsonString(result))
		}
	}
	return result, nil
}
