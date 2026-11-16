package main

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"strings"

	"github.com/egoist/mygo"
)

// smokeStorage checks settings → 数据 in the webview: the card of the data
// folder shows its total and its parts, a picture just left unused counts
// as reclaimable but within the grace, so that 立即清理 waits.
func (a *app) smokeStorage(main *mygo.Window) (map[string]any, error) {
	db, err := a.atlas.store()
	if err != nil {
		return nil, err
	}
	name, err := saveImage(a.dataDir, smokePNG(0x99))
	if err != nil {
		return nil, err
	}
	result, err := mygo.EvalAs[map[string]any](main.Page(), `
		const until = async (check) => {
			for (let i = 0; i < 100; i++) {
				if (check()) return true;
				await new Promise((r) => setTimeout(r, 100));
			}
			return false;
		};
		const result = {};
		document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true, cancelable: true }));
		const dialog = () => document.querySelector('[role="dialog"]');
		result.opened = await until(() => !!dialog());
		const tab = [...(dialog()?.querySelectorAll('[role="tab"]') ?? [])].find((t) => t.textContent.trim() === "数据");
		tab?.focus();
		tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
		const total = () => dialog()?.querySelector("[data-storage-total]");
		result.totalShown = await until(() => !!total());
		result.total = Number(total()?.dataset.storageTotal ?? 0);
		result.parts = [...(dialog()?.querySelectorAll("[data-storage-part]") ?? [])].map((li) => li.dataset.storagePart);
		const text = dialog()?.textContent ?? "";
		result.reclaim = text.includes("个文件没人用了") && text.includes("刚不再使用");
		const clean = [...(dialog()?.querySelectorAll("button") ?? [])].find((b) => b.textContent.includes("立即清理"));
		result.cleanWaits = !!clean && clean.disabled;
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		result.closed = await until(() => !dialog());
		return result;
	`)
	if err != nil {
		return result, err
	}
	for _, k := range []string{"opened", "totalShown", "reclaim", "cleanWaits", "closed"} {
		if result[k] != true {
			return result, errors.New("storage: " + k + " failed: " + jsonString(result))
		}
	}
	parts, _ := result["parts"].([]any)
	var kinds []string
	for _, p := range parts {
		s, _ := p.(string)
		kinds = append(kinds, s)
	}
	if strings.Join(kinds, ",") != "database,images,files,wallpapers,other" {
		return result, errors.New("storage: unexpected parts: " + jsonString(result))
	}
	if total, _ := result["total"].(float64); total < float64(databaseSize(a.dataDir)) {
		return result, errors.New("storage: the total is less than the database: " + jsonString(result))
	}
	// The picture of this check goes, with whatever else no text refers to.
	if _, err := cleanOnce(db, a.dataDir, 0); err != nil {
		return result, err
	}
	result["picture"] = name
	return result, nil
}

// smokePNG is a small real PNG, its shade setting it apart.
func smokePNG(shade uint8) []byte {
	img := image.NewRGBA(image.Rect(0, 0, 8, 6))
	img.Set(1, 1, color.RGBA{R: shade, G: shade, B: 0x20, A: 255})
	var buf bytes.Buffer
	png.Encode(&buf, img)
	return buf.Bytes()
}
