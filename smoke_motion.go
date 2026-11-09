package main

import (
	"errors"

	"github.com/egoist/mygo"
)

// motionChecks are the checks of smokeMotion, each true when it passed.
var motionChecks = []string{"viewGlide", "viewSwitch", "statusGlide", "typeGlide", "sidebarGlide", "flip"}

// smokeMotion checks the motion of the main window: the highlight under the
// view picked, the status and the kind in the detail, and the project in
// the sidebar sits on the part picked, and slides on as the view switches;
// marking a row done moves the rows to their new places with an animation,
// unless the system asks for less motion, when none plays.
func (a *app) smokeMotion(main *mygo.Window) (map[string]any, error) {
	result, err := mygo.EvalAs[map[string]any](main.Page(), `
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const until = async (check, ms = 5000, step = 50) => {
			for (let t = 0; t < ms; t += step) {
				if (await check()) return true;
				await sleep(step);
			}
			return false;
		};
		const rows = () => [...document.querySelectorAll("[data-queue-row]")];
		const row = (title) => rows().find((el) => el.textContent.includes(title));
		const glideOf = (group) => group?.querySelector(":scope > span[aria-hidden]");
		// The highlight is shown, as wide as the part, and where it is.
		const sits = (group, picked) => {
			const g = glideOf(group);
			return !!g && !!picked && g.style.opacity === "1" &&
				Math.abs(parseFloat(g.style.width) - picked.offsetWidth) < 1 &&
				g.style.transform.startsWith("translate(" + picked.offsetLeft + "px,");
		};
		const views = () => document.querySelector('[role="radiogroup"][aria-label="视图"]');
		const view = (label) => views()?.querySelector('[aria-label="' + label + '"]');
		const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
		const out = { reduced };

		if (!(await until(() => row("乙条")))) return { error: "the queue did not show" };
		out.viewGlide = await until(() => sits(views(), view("队列")));
		view("总览").click();
		out.viewSwitch = await until(() => view("总览")?.dataset.state === "on" && sits(views(), view("总览")));
		view("队列").click();
		out.viewSwitch = out.viewSwitch && (await until(() => view("队列")?.dataset.state === "on" && sits(views(), view("队列")) && row("乙条")));

		row("乙条").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		const segments = (label) =>
			[...document.querySelectorAll('[role="group"][aria-label="' + label + '"]')].find((g) => g.querySelector("[aria-pressed]"));
		const lit = (label) => segments(label)?.querySelector('[aria-pressed="true"]');
		out.statusGlide = await until(() => sits(segments("状态"), lit("状态")) && glideOf(segments("状态")).style.getPropertyValue("--chip") !== "");
		out.typeGlide = await until(() => sits(segments("类型"), lit("类型")));

		const projectRow = document.querySelector('aside [data-active="true"]');
		const sidebarGlide = [...document.querySelectorAll("aside span[aria-hidden]")].find((s) => s.className.includes("bg-sidebar-accent"));
		out.sidebarGlide = !!projectRow && !!sidebarGlide && sidebarGlide.style.opacity === "1" &&
			Math.abs(parseFloat(sidebarGlide.style.height) - projectRow.offsetHeight) < 1;

		// Marked done, 乙条 leaves 待办: the rows move with an animation.
		const project = (await mygo.call("Atlas.Projects")).find((p) => p.name === "冒烟测试项目");
		const yi = (await mygo.call("Atlas.Items", project.id)).find((i) => i.title === "乙条");
		const moving = () =>
			[...document.querySelectorAll("[data-flip]")].some((el) =>
				el.getAnimations().some((an) => JSON.stringify(an.effect.getKeyframes()).includes("translateY")));
		const circle = row("乙条")?.querySelector("button[aria-label]");
		if (!circle) return { error: "no circle: " + (row("乙条")?.outerHTML ?? "no row").slice(0, 300), ...out };
		circle.click();
		const moved = await until(moving, 2000, 5);
		out.flip = reduced ? !moved : moved;
		await mygo.call("Atlas.ReopenItem", yi.id);
		await until(() => row("乙条")?.closest("[data-queue-section]")?.dataset.queueSection === "todo");
		document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		return out;
	`)
	if err != nil {
		return nil, err
	}
	if msg, ok := result["error"].(string); ok {
		return result, errors.New(msg)
	}
	for _, k := range motionChecks {
		if result[k] != true {
			return result, errors.New("motion: " + k + " failed: " + jsonString(result))
		}
	}
	return result, nil
}
