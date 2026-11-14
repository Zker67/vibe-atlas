package main

import (
	"errors"

	"github.com/egoist/mygo"
)

// trashChecks are the checks of smokeTrash, each true when it passed.
var trashChecks = []string{
	"deleteTrashes", "childMovedUp", "toastOffersUndo", "ctrlZRestores",
	"shiftShowsPurge", "shiftDeleteAsks", "cancelKeeps",
	"trashViewLists", "whereShown", "enterRestores", "escapeBack",
}

// smokeTrash checks the trash in the main window, with the events the keys
// send: Delete moves the selected item to the trash with nothing to
// confirm, its child moving up, and a toast offers to undo; Ctrl+Z puts it
// back, its child under it again; holding Shift turns the delete button of
// the detail into 彻底删除, and Shift+Delete asks first, Cancel keeping the
// item; the trash, opened from the sidebar, lists the item with its
// organization and project, Enter restores
// it, and Escape goes back to the queue.
func (a *app) smokeTrash(main *mygo.Window) (map[string]any, error) {
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
			mygo.call("Atlas.CreateItem", { projectId: project.id, parentId, moduleId: 0, type: "bug", title });
		const top = await add("回收测试条");
		await add("回收测试的子条", top.id);
		const items = async () => {
			const list = await mygo.call("Atlas.Items", project.id);
			return Object.fromEntries(list.map((i) => [i.title, i]));
		};
		const rows = () => [...document.querySelectorAll("[data-queue-row]")];
		const row = (title) => rows().find((el) => el.textContent.includes(title));
		const click = (el, opts = {}) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...opts }));
		const key = (k, opts = {}, type = "keydown") =>
			document.body.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, ...opts }));
		const deleteButton = () => document.querySelector('button[aria-label^="删除到回收站"], button[aria-label^="彻底删除"]');

		const out = {};
		if (!(await until(() => row("回收测试的子条")))) return { error: "the rows did not show" };
		// A menu the checks before left open would keep the keys from the queue.
		const overlay = () => document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
		for (let i = 0; i < 5 && overlay(); i++) {
			overlay().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
			await until(() => !overlay(), 600);
		}
		if (overlay()) return { error: "an overlay stays open: " + overlay().getAttribute("role") };
		document.activeElement?.blur?.();
		key("Escape");

		click(row("回收测试条"));
		await until(() => !!deleteButton());
		key("Delete");
		out.deleteTrashes = await until(async () => {
			const by = await items();
			return !by["回收测试条"] && (await mygo.call("Atlas.TrashCount")) === 1;
		});
		out.childMovedUp = (await items())["回收测试的子条"]?.parentId === 0;
		out.toastOffersUndo = await until(() =>
			[...document.querySelectorAll("[data-sonner-toast]")].some((t) => t.textContent.includes("已移到回收站") && t.textContent.includes("撤销")),
		);

		key("z", { ctrlKey: true });
		out.ctrlZRestores = await until(async () => {
			const by = await items();
			return by["回收测试条"]?.id === top.id && by["回收测试的子条"]?.parentId === top.id && (await mygo.call("Atlas.TrashCount")) === 0;
		});

		await until(() => row("回收测试条"));
		click(row("回收测试条"));
		await until(() => !!deleteButton());
		key("Shift", { shiftKey: true });
		out.shiftShowsPurge = await until(() => deleteButton()?.getAttribute("aria-label").startsWith("彻底删除"));
		key("Shift", {}, "keyup");
		await until(() => deleteButton()?.getAttribute("aria-label").startsWith("删除到回收站"));

		key("Delete", { shiftKey: true });
		out.shiftDeleteAsks = await until(() => document.querySelector('[role="alertdialog"]')?.textContent.includes("彻底删除"));
		const cancel = [...(document.querySelector('[role="alertdialog"]')?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "取消");
		cancel?.click();
		out.cancelKeeps = await until(async () => !document.querySelector('[role="alertdialog"]') && !!(await items())["回收测试条"]);

		await until(() => row("回收测试条"));
		click(row("回收测试条"));
		await until(() => !!deleteButton());
		key("Delete");
		await until(async () => (await mygo.call("Atlas.TrashCount")) === 1);
		const trashButton = [...document.querySelectorAll("aside button")].find((b) => b.textContent.startsWith("回收站"));
		click(trashButton);
		const entry = () => [...document.querySelectorAll("[data-trash-entry]")].find((el) => el.textContent.includes("回收测试条"));
		out.trashViewLists = await until(() => !!entry());
		// Where it was: the organization, then the project.
		const personal = (await mygo.call("Atlas.Orgs")).find((o) => o.personal);
		const where = entry()?.textContent ?? "";
		out.whereShown = where.includes(personal.name + "冒烟测试项目");
		click(entry());
		key("Enter");
		out.enterRestores = await until(async () => {
			const by = await items();
			return by["回收测试条"]?.id === top.id && by["回收测试的子条"]?.parentId === top.id && (await mygo.call("Atlas.TrashCount")) === 0;
		});
		await until(() => !entry());
		key("Escape");
		out.escapeBack = await until(() => !!row("回收测试条"));
		key("Escape");
		return out;
	`)
	if err != nil {
		return nil, err
	}
	if msg, ok := result["error"].(string); ok {
		return result, errors.New(msg)
	}
	for _, k := range trashChecks {
		if result[k] != true {
			return result, errors.New("trash: " + k + " failed: " + jsonString(result))
		}
	}
	return result, nil
}
