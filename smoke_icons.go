package main

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strconv"

	"github.com/egoist/mygo"
)

// smokeIcons checks the icons of projects in the webview: a project added
// with a folder and no name takes the folder's name and the icon found in
// it, shrunk, which the sidebar loads from the image scheme; an emoji
// chosen then takes its place.
func (a *app) smokeIcons(main *mygo.Window) (map[string]any, error) {
	folder := filepath.Join(a.dataDir, "smoke-projects", "图标项目")
	img := image.NewRGBA(image.Rect(0, 0, 512, 512))
	for i := range img.Pix {
		img.Pix[i] = 0x80
	}
	img.Set(5, 5, color.RGBA{G: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(folder, "resources"), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(folder, "resources", "icon.png"), buf.Bytes(), 0o644); err != nil {
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
		const p = await mygo.call("Atlas.AddProject", { name: "", folderPath: `+strconv.Quote(folder)+`, icon: "" });
		result.name = p.name;
		result.detected = p.detectedIcon;
		const row = () => [...document.querySelectorAll("aside button")].find((b) => b.textContent.includes(p.name));
		result.rowShown = await until(() => !!row());
		result.imageShown = await until(() => {
			const i = row()?.querySelector("img");
			return !!i && i.complete && i.naturalWidth === 128;
		});
		await mygo.call("Atlas.SetProjectIcon", p.id, "emoji:🎮");
		result.emojiShown = await until(() => row()?.querySelector("svg text")?.textContent === "🎮");
		await mygo.call("Atlas.DeleteProject", p.id);
		result.removed = await until(() => !row());
		return result;
	`)
	if err != nil {
		return result, err
	}
	if result["name"] != "图标项目" {
		return result, errors.New("icons: the project did not take its folder's name: " + jsonString(result))
	}
	if d, _ := result["detected"].(string); d == "" {
		return result, errors.New("icons: no icon found in the folder: " + jsonString(result))
	}
	for _, k := range []string{"rowShown", "imageShown", "emojiShown", "removed"} {
		if result[k] != true {
			return result, errors.New("icons: " + k + " failed: " + jsonString(result))
		}
	}
	return result, nil
}
