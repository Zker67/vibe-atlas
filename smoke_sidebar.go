package main

import (
	"errors"

	"github.com/egoist/mygo"
)

// sidebarChecks are the checks of smokeSidebar, each true when it passed.
var sidebarChecks = []string{"startsOpen", "collapses", "iconsOnly", "remembered", "iconOpens", "expands"}

// smokeSidebar folds the sidebar with Ctrl+\ into a rail of icons: the
// names go, each row says its name to screen readers, the choice is kept
// on this machine, a click on a project's icon opens it; Ctrl+\ again
// unfolds it.
func (a *app) smokeSidebar(main *mygo.Window) (map[string]any, error) {
	result, err := mygo.EvalAs[map[string]any](main.Page(), `
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const until = async (check, ms = 3000) => {
			for (let t = 0; t < ms; t += 50) {
				if (await check()) return true;
				await sleep(50);
			}
			return false;
		};
		const toggle = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "\\", ctrlKey: true, bubbles: true, cancelable: true }));
		const aside = () => document.querySelector("aside");
		const name = "冒烟侧栏项目";
		const created = await mygo.call("Atlas.CreateProject", name);
		const out = {};
		out.startsOpen = !aside().hasAttribute("data-collapsed") && aside().offsetWidth > 200;
		toggle();
		out.collapses = await until(() => aside().hasAttribute("data-collapsed") && aside().offsetWidth <= 64);
		const row = () => aside().querySelector('button[aria-label="' + name + '"]');
		out.iconsOnly = (await until(() => row())) && !aside().textContent.includes(name) && !aside().textContent.includes("回收站");
		out.remembered = localStorage.getItem("vibe-atlas-sidebar-collapsed") === "1";
		row().click();
		out.iconOpens = await until(() => row()?.getAttribute("data-active") === "true");
		// Back to the project the later checks work in.
		const home = () => aside().querySelector('button[aria-label="冒烟测试项目"]');
		home()?.click();
		await until(() => home()?.getAttribute("data-active") === "true");
		toggle();
		out.expands = await until(() => !aside().hasAttribute("data-collapsed") && aside().offsetWidth > 200 && aside().textContent.includes(name));
		await mygo.call("Atlas.DeleteProject", created.id);
		return out;
	`)
	if err != nil {
		return nil, err
	}
	for _, k := range sidebarChecks {
		if result[k] != true {
			return result, errors.New("sidebar: " + k + " failed: " + jsonString(result))
		}
	}
	return result, nil
}
