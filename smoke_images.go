package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/egoist/mygo"
)

// smokeImages checks the pictures of the notes in the webview: one saved
// from the page loads from the image scheme, the note editor shows it as a
// card in place of its Markdown, copying puts its path on this machine, and
// once its item is gone the cleanup deletes it.
func (a *app) smokeImages(main *mygo.Window) (map[string]any, error) {
	db, err := a.atlas.store()
	if err != nil {
		return nil, err
	}
	img := image.NewRGBA(image.Rect(0, 0, 48, 30))
	for i := range img.Pix {
		img.Pix[i] = 0xc0
	}
	img.Set(3, 3, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
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
		const name = await mygo.call("Atlas.SaveImage", `+strconv.Quote(base64.StdEncoding.EncodeToString(buf.Bytes()))+`);
		result.name = name;
		const base = await mygo.call("Atlas.ImageBase");
		result.url = base + name;
		const img = new Image();
		img.src = base + name;
		try {
			await img.decode();
			result.loaded = img.naturalWidth === 48 && img.naturalHeight === 30;
		} catch (e) {
			result.loaded = false;
			result.loadError = String(e);
		}
		try {
			await mygo.call("Atlas.SaveImage", btoa("not a picture"));
			result.refused = "";
		} catch (e) {
			result.refused = e.message;
		}
		const project = (await mygo.call("Atlas.Projects")).find((p) => p.name === "冒烟测试项目");
		const item = await mygo.call("Atlas.CreateItem", {
			projectId: project.id, parentId: 0, moduleId: 0, type: "improve",
			title: "冒烟图片条目", note: "看图：\n\n![](image:" + name + ")",
		});
		result.itemId = item.id;
		const row = () => document.querySelector('[data-item-id="' + item.id + '"]');
		result.rowShown = await until(() => !!row());
		row()?.click();
		const note = () => document.querySelector('[aria-label="备注"] .cm-content');
		const card = () => note()?.querySelector(".cm-md-picture img");
		result.cardShown = await until(() => {
			const c = card();
			return !!c && c.complete && c.naturalWidth === 48;
		});
		result.sourceHidden = !!note() && !note().textContent.includes("image:");
		result.textShown = !!note() && note().textContent.includes("看图");
		return result;
	`)
	if err != nil {
		return result, err
	}
	for _, k := range []string{"loaded", "rowShown", "cardShown", "sourceHidden", "textShown"} {
		if result[k] != true {
			return result, errors.New("images: " + k + " failed: " + jsonString(result))
		}
	}
	if refused, _ := result["refused"].(string); !strings.Contains(refused, "不支持") {
		return result, errors.New("images: a file that is not a picture was taken: " + jsonString(result))
	}

	name, _ := result["name"].(string)
	id, _ := result["itemId"].(float64)
	path := filepath.Join(imageDir(a.dataDir), name)
	if _, err := os.Stat(path); err != nil {
		return result, err
	}
	it, err := db.Item(int64(id))
	if err != nil {
		return result, err
	}
	copied := withImagePaths(ItemText(it, nil), a.dataDir)
	result["copied"] = copied
	if !strings.Contains(copied, "![](<"+path+">)") {
		return result, errors.New("images: copying does not put the picture's path: " + copied)
	}

	if err := a.atlas.DeleteItem(int64(id)); err != nil {
		return result, err
	}
	if n, err := cleanImages(db, a.dataDir, 0); err != nil || n != 1 {
		return result, errors.Join(err, errors.New("images: the cleanup deleted "+strconv.Itoa(n)+", want 1"))
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		return result, errors.New("images: the picture of a deleted item stays after the cleanup")
	}
	result["cleaned"] = true
	return result, nil
}
