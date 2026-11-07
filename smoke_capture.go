package main

import (
	"errors"
	"fmt"
	"time"

	"github.com/egoist/mygo"
)

// smokeCapturePanel drives the quick capture panel as the keys would: it
// is one line high, Shift+Enter opens the notes and the link and the
// window grows to them, and Enter in the link saves all of it and folds
// the panel back. A project must exist.
func (a *app) smokeCapturePanel(capture *mygo.Window) (map[string]any, error) {
	result := map[string]any{}
	if err := waitFor(capture, "[data-capture-title]"); err != nil {
		return result, err
	}
	// height waits for the window's page area to take a height that
	// passes check, as the page tells its content's.
	height := func(what string, check func(int) bool) (int, error) {
		var h int
		for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
			if _, h = capture.ContentSize(); check(h) {
				return h, nil
			}
		}
		return h, fmt.Errorf("capture panel %s: height stayed %d", what, h)
	}

	compact, err := height("compact", func(h int) bool { return h > 60 && h < 160 })
	result["compactHeight"] = compact
	if err != nil {
		return result, err
	}

	opened, err := mygo.EvalAs[bool](capture.Page(), `
		const tick = () => new Promise((r) => setTimeout(r, 50));
		const title = document.querySelector("[data-capture-title]");
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(title, "小窗界面记下的");
		title.dispatchEvent(new Event("input", { bubbles: true }));
		await tick();
		title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
		for (let i = 0; i < 100; i++) {
			if (document.querySelector("[data-capture-details] .cm-content")) return true;
			await tick();
		}
		return false;
	`)
	if err != nil {
		return result, err
	}
	if !opened {
		return result, errors.New("Shift+Enter did not open the notes")
	}
	expanded, err := height("with details", func(h int) bool { return h > compact+80 })
	result["detailsHeight"] = expanded
	if err != nil {
		return result, err
	}

	saved, err := mygo.EvalAs[map[string]any](capture.Page(), `
		const tick = () => new Promise((r) => setTimeout(r, 50));
		const link = document.querySelector("[data-capture-link]");
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(link, "https://example.com/smoke");
		link.dispatchEvent(new Event("input", { bubbles: true }));
		await tick();
		link.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		for (let i = 0; i < 100; i++) {
			for (const p of await mygo.call("Atlas.Projects")) {
				const item = (await mygo.call("Atlas.Items", p.id)).find((it) => it.title === "小窗界面记下的");
				if (item) {
					await tick();
					return {
						deeplink: item.deeplink,
						titleCleared: document.querySelector("[data-capture-title]").value === "",
						detailsClosed: !document.querySelector("[data-capture-details]"),
					};
				}
			}
			await tick();
		}
		return { deeplink: null };
	`)
	result["saved"] = saved
	if err != nil {
		return result, err
	}
	if saved["deeplink"] != "https://example.com/smoke" || saved["titleCleared"] != true || saved["detailsClosed"] != true {
		return result, errors.New("Enter in the link did not save the item with it: " + jsonString(saved))
	}
	folded, err := height("after saving", func(h int) bool { return h <= compact+4 })
	result["foldedHeight"] = folded
	return result, err
}
