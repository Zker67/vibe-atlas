package main

import (
	"errors"

	"github.com/egoist/mygo"
)

// menuChecks are the checks of smokeMenu, each true when it passed.
var menuChecks = []string{"rowMenuOpens", "rowPressKept", "rowItemActs", "rowMenuCloses", "projectMenuOpens", "projectPressKept", "projectItemActs"}

// smokeMenu checks the right-click menus with the events the mouse sends:
// a row of the queue opens its menu; pressing 开始进行 is left to the menu
// (nothing under it cancels the press or drops the selection), and the
// click starts the item and closes the menu; a project in the sidebar opens
// its menu, and a click on 编辑项目 opens the dialog that edits it.
func (a *app) smokeMenu(main *mygo.Window) (map[string]any, error) {
	result, err := mygo.EvalAs[map[string]any](main.Page(), `
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const until = async (check, ms = 3000) => {
			for (let t = 0; t < ms; t += 50) {
				if (await check()) return true;
				await sleep(50);
			}
			return false;
		};
		const center = (el) => {
			const r = el.getBoundingClientRect();
			return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
		};
		const fire = (el, type, init) => {
			const Kind = type.startsWith("pointer") ? PointerEvent : MouseEvent;
			return el.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, composed: true, pointerId: 51, pointerType: "mouse", isPrimary: true, ...init }));
		};
		// What the mouse sends for a right click, and for a left click on what it opened.
		const rightClick = (el) => {
			const at = center(el);
			fire(el, "pointerdown", { ...at, button: 2, buttons: 2 });
			fire(el, "mousedown", { ...at, button: 2, buttons: 2 });
			fire(el, "contextmenu", { ...at, button: 2, buttons: 2 });
			fire(el, "pointerup", { ...at, button: 2, buttons: 0 });
			fire(el, "mouseup", { ...at, button: 2, buttons: 0 });
		};
		// The press says whether it went through: something under the menu that
		// cancels it, as the queue's marquee did, also takes the real mouse's
		// pointer away from the menu, and the click never reaches the item.
		const press = (el) => {
			const at = center(el);
			fire(el, "pointermove", { ...at, button: -1, buttons: 0 });
			return fire(el, "pointerdown", { ...at, button: 0, buttons: 1 }) && fire(el, "mousedown", { ...at, button: 0, buttons: 1 });
		};
		const release = (el) => {
			const at = center(el);
			fire(el, "pointerup", { ...at, button: 0, buttons: 0 });
			fire(el, "mouseup", { ...at, button: 0, buttons: 0 });
			fire(el, "click", { ...at, button: 0, buttons: 0 });
		};
		const menu = () => document.querySelector('[role="menu"][data-state="open"]');
		const menuItem = (label) => [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].find((el) => el.textContent.includes(label));
		const rows = () => [...document.querySelectorAll("[data-queue-row]")];
		const row = (title) => rows().find((el) => el.textContent.includes(title));
		const project = (await mygo.call("Atlas.Projects")).find((p) => p.name === "冒烟测试项目");
		const status = async (title) => (await mygo.call("Atlas.Items", project.id)).find((i) => i.title === title)?.status;
		const out = {};

		const title = "右键菜单条目";
		await mygo.call("Atlas.CreateItem", { projectId: project.id, moduleId: 0, type: "improve", title });
		if (!(await until(() => row(title)))) return { error: "the row did not show" };
		rightClick(row(title));
		out.rowMenuOpens = await until(() => menuItem("开始进行"));
		if (!out.rowMenuOpens) return out;
		await sleep(150); // past the menu's opening
		// The row the menu is for stays selected while the item is pressed.
		out.rowPressKept = press(menuItem("开始进行")) && row(title).hasAttribute("aria-current");
		release(menuItem("开始进行"));
		out.rowItemActs = await until(async () => (await status(title)) === "doing");
		out.rowMenuCloses = await until(() => !menu());

		const projectRow = [...document.querySelectorAll("aside [data-active]")].find((el) => el.textContent.includes("冒烟测试项目"));
		if (!projectRow) return { error: "no project in the sidebar", ...out };
		rightClick(projectRow);
		out.projectMenuOpens = await until(() => menuItem("编辑项目"));
		if (!out.projectMenuOpens) return out;
		await sleep(150);
		out.projectPressKept = press(menuItem("编辑项目"));
		release(menuItem("编辑项目"));
		out.projectItemActs = await until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => d.textContent.includes("编辑项目")));
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		await until(() => !document.querySelector('[role="dialog"]'));
		return out;
	`)
	if err != nil {
		return nil, err
	}
	if msg, ok := result["error"].(string); ok {
		return result, errors.New(msg)
	}
	for _, k := range menuChecks {
		if result[k] != true {
			return result, errors.New("menu: " + k + " failed: " + jsonString(result))
		}
	}
	return result, nil
}
