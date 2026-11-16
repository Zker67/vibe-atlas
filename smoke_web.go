package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"
)

// webChecks are the checks of smokeWebPictures, each true when it passed.
var webChecks = []string{"rowShown", "placeholderShown", "sourceHidden", "noImage", "loaded", "menuOpens", "saved"}

// smokeWebPictures checks a picture on the web in a note, served here: it
// shows as a placeholder that asks nothing of the web; 加载 shows it, and
// its menu's 保存到本地 downloads it into the app and refers to it there.
func (a *app) smokeWebPictures(main *mygo.Window) (map[string]any, error) {
	db, err := a.atlas.store()
	if err != nil {
		return nil, err
	}
	var hits atomic.Int32
	pic := smokePNG(0x44)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "image/png")
		w.Write(pic)
	}))
	defer srv.Close()
	url := srv.URL + "/smoke/web.png"

	const js = `
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
			return el.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, composed: true, pointerId: 53, pointerType: "mouse", isPrimary: true, ...init }));
		};
		const menu = () => document.querySelector('[role="menu"][data-state="open"]');
		const menuItem = (label) => [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].find((el) => el.textContent.includes(label));
		const note = () => document.querySelector('[aria-label="备注"] .cm-content');
		const card = () => note()?.querySelector(".cm-md-picture[data-web]");
		const result = {};
	`
	result, err := mygo.EvalAs[map[string]any](main.Page(), js+`
		const project = (await mygo.call("Atlas.Projects")).find((p) => p.name === "冒烟测试项目");
		const item = await mygo.call("Atlas.CreateItem", {
			projectId: project.id, parentId: 0, moduleId: 0, type: "improve",
			title: "冒烟网络图片", note: "网上的图：\n\n![网图](`+url+`)",
		});
		result.itemId = item.id;
		const row = () => document.querySelector('[data-item-id="' + item.id + '"]');
		result.rowShown = await until(() => !!row());
		row()?.click();
		result.placeholderShown = await until(() => card()?.dataset.placeholder !== undefined);
		result.host = card()?.querySelector(".cm-md-picture-web-host")?.textContent ?? "";
		result.sourceHidden = !!note() && !note().textContent.includes("http");
		result.noImage = !!card() && !card().querySelector("img");
		return result;
	`)
	if err != nil {
		return result, err
	}
	asked := hits.Load()
	result["hitsBeforeLoad"] = asked

	more, err := mygo.EvalAs[map[string]any](main.Page(), js+`
		card()?.querySelector('[data-act="load"]')?.click();
		result.loaded = await until(() => {
			const img = card()?.querySelector("img");
			return !!img && img.complete && img.naturalWidth === 8;
		});
		const c = card();
		if (c) {
			const at = center(c);
			fire(c, "pointerdown", { ...at, button: 2, buttons: 2 });
			fire(c, "mousedown", { ...at, button: 2, buttons: 2 });
			fire(c, "contextmenu", { ...at, button: 2, buttons: 2 });
		}
		result.menuOpens = await until(() => !!menuItem("保存到本地"));
		result.menuItems = [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].map((el) => el.textContent.trim()).join();
		await sleep(150);
		const save = menuItem("保存到本地");
		if (save) {
			const p = center(save);
			fire(save, "pointermove", { ...p, button: -1, buttons: 0 });
			fire(save, "pointerdown", { ...p, button: 0, buttons: 1 });
			fire(save, "mousedown", { ...p, button: 0, buttons: 1 });
			fire(save, "pointerup", { ...p, button: 0, buttons: 0 });
			fire(save, "mouseup", { ...p, button: 0, buttons: 0 });
			fire(save, "click", { ...p, button: 0, buttons: 0 });
		}
		// Saved: a picture of the app in its place.
		result.saved = await until(() => !card() && !!note()?.querySelector(".cm-md-picture img") && note().querySelector(".cm-md-picture img").naturalWidth === 8);
		return result;
	`)
	for k, v := range more {
		result[k] = v
	}
	if err != nil {
		return result, err
	}
	for _, k := range webChecks {
		if result[k] != true {
			return result, errors.New("web pictures: " + k + " failed: " + jsonString(result))
		}
	}
	if asked != 0 {
		return result, errors.New("web pictures: the placeholder asked the web " + strconv.Itoa(int(asked)) + " times")
	}
	if items, _ := result["menuItems"].(string); items != "保存到本地,在浏览器中打开,复制图片地址,删除图片" {
		return result, errors.New("web pictures: the menu of a loaded picture: " + items)
	}

	id, _ := result["itemId"].(float64)
	var saved string
	for i := 0; i < 50; i++ { // the note saves as the typing pauses
		it, err := db.Item(int64(id))
		if err != nil {
			return result, err
		}
		saved = it.Note
		if strings.Contains(saved, "image:") {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	result["note"] = saved
	if !strings.Contains(saved, "![网图](image:") || strings.Contains(saved, srv.URL) {
		return result, errors.New("web pictures: the note is " + strconv.Quote(saved))
	}
	return result, a.atlas.DeleteItem(int64(id))
}
