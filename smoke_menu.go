package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/png"
	"strconv"

	"github.com/egoist/mygo"
)

// menuChecks are the checks of smokeMenu, each true when it passed.
var menuChecks = []string{"rowMenuOpens", "rowPressKept", "rowItemActs", "rowMenuCloses", "projectMenuOpens", "projectPressKept", "projectItemActs",
	"textMenuOpens", "textMenuItems", "textPastes", "pictureMenuOpens", "pictureMenuItems", "pictureMenuCloses"}

// smokeMenu checks the right-click menus with the events the mouse sends:
// a row of the queue opens its menu; pressing 开始进行 is left to the menu
// (nothing under it cancels the press or drops the selection), and the
// click starts the item and closes the menu; a project in the sidebar opens
// its menu, and a click on 编辑项目 opens the dialog that edits it. The
// page's own menus: a note opens the text menu, whose 粘贴 puts in what is
// on the clipboard (which this sets); a picture in a note opens the
// picture menu, with 打开文件夹位置, and Esc closes it.
func (a *app) smokeMenu(main *mygo.Window) (map[string]any, error) {
	var pic bytes.Buffer
	if err := png.Encode(&pic, image.NewGray(image.Rect(0, 0, 12, 8))); err != nil {
		return nil, err
	}
	const pasted = "右键粘贴的文字"
	mygo.Clipboard.WriteText(pasted)
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

		// The page's own menu for text, in the note of the item selected.
		const select = (title) => {
			press(row(title));
			release(row(title));
		};
		select(title);
		await sleep(300);
		const note = () => document.querySelector('[aria-label="备注"] .cm-content');
		if (!(await until(() => note()))) return { error: "no note in the details", ...out };
		rightClick(note());
		out.textMenuOpens = await until(() => menuItem("粘贴"));
		if (!out.textMenuOpens) return out;
		const labels = () => [...menu().querySelectorAll('[role="menuitem"]')].map((el) => el.textContent.replace(/Ctrl.*$/, ""));
		out.textMenuItems = labels().join() === "剪切,复制,粘贴,全选" && menuItem("剪切").hasAttribute("data-disabled");
		await sleep(150);
		press(menuItem("粘贴"));
		release(menuItem("粘贴"));
		out.textPastes = await until(() => note()?.textContent.includes(` + strconv.Quote(pasted) + `));

		// The picture's menu, on its card in a note.
		const name = await mygo.call("Atlas.SaveImage", ` + strconv.Quote(base64.StdEncoding.EncodeToString(pic.Bytes())) + `);
		const picTitle = "右键菜单图片";
		await mygo.call("Atlas.CreateItem", { projectId: project.id, moduleId: 0, type: "improve", title: picTitle, note: "![](image:" + name + ")" });
		if (!(await until(() => row(picTitle)))) return { error: "the picture's row did not show", ...out };
		select(picTitle);
		const card = () => note()?.querySelector(".cm-md-picture img");
		if (!(await until(() => card()?.complete && card().naturalWidth === 12))) return { error: "no picture card", ...out };
		rightClick(card());
		out.pictureMenuOpens = await until(() => menuItem("打开文件夹位置"));
		if (!out.pictureMenuOpens) return out;
		out.pictureMenuItems = labels().join() === "查看大图,复制图片,用默认应用打开,打开文件夹位置,删除图片";
		await sleep(150);
		menu().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		out.pictureMenuCloses = await until(() => !menu());
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
