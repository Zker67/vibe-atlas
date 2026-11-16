package main

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

// fileChecks are the checks of smokeFiles, each true when it passed.
var fileChecks = []string{"rowShown", "editorShown", "inlineStaysLink", "cardShown", "storedBadge", "menuOpens", "unstored", "linkedBadge"}

// smokeFiles pastes a file copied in a file manager into a note in the
// webview, as Ctrl+V does: it becomes a card marked 已另存, kept in the data
// folder; its menu's 改为原地引用 turns it into a file: link marked 原地. A
// link to a file among other text stays a link. The clipboard is the
// machine's: the check overwrites it.
func (a *app) smokeFiles(main *mygo.Window) (map[string]any, error) {
	db, err := a.atlas.store()
	if err != nil {
		return nil, err
	}
	src, err := os.MkdirTemp("", "vibe-atlas-smoke-files-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(src)
	path := filepath.Join(src, "冒烟 附件.txt")
	if err := os.WriteFile(path, []byte("冒烟测试的附件"), 0o644); err != nil {
		return nil, err
	}
	data, err := transfer.FileData(path)
	if err != nil {
		return nil, err
	}
	if err := mygo.Clipboard.Write(data); err != nil {
		return nil, err
	}
	inline := "文字里的 [链接](<" + fileLink(path) + ">) 不成卡片"

	result, err := mygo.EvalAs[map[string]any](main.Page(), `
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const until = async (check, ms = 5000) => {
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
			return el.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, composed: true, pointerId: 52, pointerType: "mouse", isPrimary: true, ...init }));
		};
		const menu = () => document.querySelector('[role="menu"][data-state="open"]');
		const menuItem = (label) => [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].find((el) => el.textContent.includes(label));
		const result = {};
		const project = (await mygo.call("Atlas.Projects")).find((p) => p.name === "冒烟测试项目");
		const item = await mygo.call("Atlas.CreateItem", { projectId: project.id, parentId: 0, moduleId: 0, type: "improve", title: "冒烟附件条目", note: `+strconv.Quote(inline)+` });
		result.itemId = item.id;
		const row = () => document.querySelector('[data-item-id="' + item.id + '"]');
		result.rowShown = await until(() => !!row());
		row()?.click();
		const note = () => document.querySelector('[aria-label="备注"]');
		const content = () => note()?.querySelector(".cm-content");
		result.editorShown = await until(() => content()?.textContent.includes("文字里的"));
		const cards = () => [...(note()?.querySelectorAll(".cm-md-file") ?? [])];
		result.inlineStaysLink = cards().length === 0;

		// What a paste of files from a file manager hands the page: no text, and no file the page may read.
		content().focus();
		content().dispatchEvent(new ClipboardEvent("paste", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
		content().blur();
		result.cardShown = await until(() => cards().length === 1 && cards()[0].dataset.loading === undefined);
		const badge = () => cards()[0]?.querySelector(".cm-md-file-badge")?.textContent ?? "";
		result.storedBadge = badge() === "已另存" && cards()[0].textContent.includes("冒烟 附件.txt");
		result.cardText = cards()[0]?.textContent ?? "";

		const card = cards()[0];
		const at = center(card);
		fire(card, "pointerdown", { ...at, button: 2, buttons: 2 });
		fire(card, "mousedown", { ...at, button: 2, buttons: 2 });
		fire(card, "contextmenu", { ...at, button: 2, buttons: 2 });
		result.menuOpens = await until(() => !!menuItem("改为原地引用"));
		result.menuItems = [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].map((el) => el.textContent.trim()).join();
		await sleep(150);
		const unstore = menuItem("改为原地引用");
		if (unstore) {
			const p = center(unstore);
			fire(unstore, "pointermove", { ...p, button: -1, buttons: 0 });
			fire(unstore, "pointerdown", { ...p, button: 0, buttons: 1 });
			fire(unstore, "mousedown", { ...p, button: 0, buttons: 1 });
			fire(unstore, "pointerup", { ...p, button: 0, buttons: 0 });
			fire(unstore, "mouseup", { ...p, button: 0, buttons: 0 });
			fire(unstore, "click", { ...p, button: 0, buttons: 0 });
		}
		result.unstored = await until(() => content().textContent.includes("file:") || badge() === "原地");
		result.linkedBadge = await until(() => badge() === "原地");
		return result;
	`)
	if err != nil {
		return result, err
	}
	for _, k := range fileChecks {
		if result[k] != true {
			return result, errors.New("files: " + k + " failed: " + jsonString(result))
		}
	}

	// The note as saved: first kept, then linked where it is.
	id, _ := result["itemId"].(float64)
	var saved string
	for i := 0; i < 50; i++ { // the note saves as the typing pauses
		it, err := db.Item(int64(id))
		if err != nil {
			return result, err
		}
		saved = it.Note
		if strings.Contains(saved, "(<file:") && !strings.Contains(saved, "attachment:") && strings.Count(saved, "file:") == 2 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	result["note"] = saved
	want := "[冒烟 附件.txt](<" + fileLink(path) + ">)"
	if !strings.Contains(saved, want) || !strings.Contains(saved, inline) {
		return result, errors.New("files: the note is " + strconv.Quote(saved) + ", want it to have " + strconv.Quote(want))
	}
	// The copy kept before it was switched: in files/, with where it came from.
	kept := ""
	entries, _ := os.ReadDir(filesDir(a.dataDir))
	for _, e := range entries {
		if m := attachmentOrigin.FindStringSubmatch(e.Name()); m != nil {
			if origin, _ := os.ReadFile(filepath.Join(filesDir(a.dataDir), e.Name())); string(origin) == path {
				kept = filepath.Join(filesDir(a.dataDir), m[1], "冒烟 附件.txt")
			}
		}
	}
	if b, err := os.ReadFile(kept); err != nil || string(b) != "冒烟测试的附件" {
		return result, errors.New("files: no copy kept in the data folder: " + kept)
	}
	if err := a.atlas.DeleteItem(int64(id)); err != nil {
		return result, err
	}
	return result, nil
}
