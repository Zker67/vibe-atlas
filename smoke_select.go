package main

import (
	"errors"

	"github.com/egoist/mygo"
)

// selectChecks are the checks of smokeSelect, each true when it passed.
var selectChecks = []string{
	"one", "ctrlAdds", "shiftRange", "ctrlShiftAdds",
	"spaceDone", "spaceReopens", "stillSelected",
	"escapeClears", "ctrlASelectsAll", "boxSelects",
	"dropLine", "groupDrags", "tabIndents", "shiftTabOutdents", "shiftArrow",
}

// smokeSelect checks selecting several rows of the queue in the main
// window, with the events the mouse and the keys send: a click selects one
// and the detail shows it, Ctrl adds one, Shift and Ctrl+Shift select from
// the anchor, and the detail says how many; Space marks them all done, then
// reopens them; Escape selects none, Ctrl+A every row; a box drawn from the
// blank ground selects the rows it spans; dragging one of the selection
// moves them all, in their order; Tab puts them a level in, Shift+Tab
// takes them back; Shift+↓ stretches the selection.
func (a *app) smokeSelect(main *mygo.Window) (map[string]any, error) {
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
		const add = (title, parentId = 0) =>
			mygo.call("Atlas.CreateItem", { projectId: project.id, parentId, moduleId: 0, type: "improve", title });
		const jia = await add("甲条");
		await add("乙条");
		await add("丙条");
		await add("甲的子条", jia.id);
		const items = async () => {
			const list = await mygo.call("Atlas.Items", project.id);
			return Object.fromEntries(list.map((i) => [i.title, i]));
		};

		const rows = () => [...document.querySelectorAll("[data-queue-row]")];
		const row = (title) => rows().find((el) => el.textContent.includes(title));
		const current = () => document.querySelector("[data-queue-row][aria-current]")?.textContent ?? "";
		const listed = () => {
			const s = document.querySelector('section[aria-label="已选的改进点"]');
			return s ? [...s.querySelectorAll("li")].map((li) => li.textContent).sort().join("|") : "";
		};
		const want = (...titles) => titles.slice().sort().join("|");
		const shown = (n) => document.body.innerText.includes("已选 " + n + " 条");
		const click = (title, opts = {}) =>
			row(title).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...opts }));
		const key = (k, opts = {}) =>
			document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }));
		// A mouse's pointer: without pointerType, the row's context menu takes it for a
		// touch and opens on a long press, which takes the keys from the queue.
		const pointer = (type, target, x, y, id) =>
			target.dispatchEvent(
				new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y }),
			);

		const out = {};
		if (!(await until(() => row("甲的子条") && row("丙条")))) return { error: "the rows did not show" };
		document.activeElement?.blur?.();

		click("甲条");
		out.one = await until(() => current().includes("甲条") && !!document.querySelector("[data-item-title]"));
		click("丙条", { ctrlKey: true });
		out.ctrlAdds = await until(() => shown(2) && listed() === want("甲条", "丙条"));
		click("乙条", { shiftKey: true });
		out.shiftRange = await until(() => listed() === want("乙条", "丙条") && current().includes("乙条"));
		click("甲条", { shiftKey: true, ctrlKey: true });
		out.ctrlShiftAdds = await until(() => shown(4) && listed() === want("甲条", "甲的子条", "乙条", "丙条"));

		const statuses = async () => {
			const by = await items();
			return ["甲条", "甲的子条", "乙条", "丙条"].map((t) => by[t].status).join(",");
		};
		key(" ");
		out.spaceDone = await until(async () => (await statuses()) === "done,done,done,done");
		key(" ");
		out.spaceReopens = await until(async () => (await statuses()) === "todo,todo,todo,todo");
		out.stillSelected = shown(4);

		key("Escape");
		out.escapeClears = await until(() => !listed() && !current());
		await until(() => row("甲的子条") && row("丙条"));
		key("a", { ctrlKey: true });
		out.ctrlASelectsAll = await until(() => shown(rows().length));
		key("Escape");
		await until(() => !listed());

		// A box from the blank ground left of the rows, from 乙条 down to 丙条.
		const viewport = row("乙条").closest(".scroller-viewport");
		const vr = viewport.getBoundingClientRect();
		const r1 = row("乙条").getBoundingClientRect();
		const r2 = row("丙条").getBoundingClientRect();
		pointer("pointerdown", viewport, vr.left + 4, r1.top + r1.height / 2, 41);
		pointer("pointermove", window, vr.left + 4, r1.top + r1.height / 2 + 10, 41);
		pointer("pointermove", window, vr.left + 4, r2.top + r2.height / 2, 41);
		out.boxSelects = await until(() => listed() === want("乙条", "丙条") && current().includes("丙条"));
		pointer("pointerup", window, vr.left + 4, r2.top + r2.height / 2, 41);

		// Dragging 丙条, one of the two, onto the top edge of 从小窗记下的 takes both there.
		const from = row("丙条").getBoundingClientRect();
		const to = row("从小窗记下的").getBoundingClientRect();
		const fx = from.left + 80;
		const fy = from.top + from.height / 2;
		const tx = to.left + 80;
		const ty = to.top + to.height * 0.1;
		pointer("pointerdown", row("丙条"), fx, fy, 42);
		pointer("pointermove", document, fx, fy + 10, 42);
		await sleep(100);
		pointer("pointermove", document, tx, ty, 42);
		out.dropLine = await until(() => !!document.querySelector(".drop-line"), 2000);
		pointer("pointerup", document, tx, ty, 42);
		out.groupDrags = await until(async () => {
			const list = Object.values(await items())
				.filter((i) => i.status === "todo" && !i.parentId)
				.sort((a, b) => a.sortOrder - b.sortOrder)
				.map((i) => i.title);
			const at = list.indexOf("从小窗记下的");
			return at >= 2 && list[at - 2] === "乙条" && list[at - 1] === "丙条";
		});

		await sleep(400);
		key("Tab");
		out.tabIndents = await until(async () => {
			const by = await items();
			return by["丙条"].parentId === by["乙条"].id && by["乙条"].parentId === 0;
		});
		key("Tab", { shiftKey: true });
		out.shiftTabOutdents = await until(async () => (await items())["丙条"].parentId === 0);

		await until(() => row("乙条") && row("丙条"));
		click("乙条");
		key("ArrowDown", { shiftKey: true });
		out.shiftArrow = await until(() => listed() === want("乙条", "丙条"));
		key("Escape");
		return out;
	`)
	if err != nil {
		return nil, err
	}
	if msg, ok := result["error"].(string); ok {
		return result, errors.New(msg)
	}
	for _, k := range selectChecks {
		if result[k] != true {
			return result, errors.New("select: " + k + " failed: " + jsonString(result))
		}
	}
	return result, nil
}
