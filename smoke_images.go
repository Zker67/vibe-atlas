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
	"time"

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

// smokePaste pastes into a note in the webview, as Ctrl+V does: a picture
// alone becomes a line of pictures; content with a picture in it becomes
// Markdown, its picture saved; content without pictures stays plain text.
func (a *app) smokePaste(main *mygo.Window) (map[string]any, error) {
	db, err := a.atlas.store()
	if err != nil {
		return nil, err
	}
	shot := func(shade uint8) (string, error) {
		img := image.NewRGBA(image.Rect(0, 0, 40, 24))
		for i := range img.Pix {
			img.Pix[i] = shade
		}
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			return "", err
		}
		return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
	}
	alone, err := shot(0x30)
	if err != nil {
		return nil, err
	}
	inside, err := shot(0x60)
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
		const fileOf = (b64, name) => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: "image/png" });
		const result = {};
		const project = (await mygo.call("Atlas.Projects")).find((p) => p.name === "冒烟测试项目");
		const item = await mygo.call("Atlas.CreateItem", { projectId: project.id, parentId: 0, moduleId: 0, type: "improve", title: "冒烟粘贴条目", note: "" });
		result.itemId = item.id;
		const row = () => document.querySelector('[data-item-id="' + item.id + '"]');
		result.rowShown = await until(() => !!row());
		row()?.click();
		const content = () => document.querySelector('[aria-label="备注"] .cm-content');
		result.editorShown = await until(() => !!content());
		const paste = (fill) => {
			const dt = new DataTransfer();
			fill(dt);
			content().focus();
			content().dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
		};

		paste((dt) => dt.items.add(fileOf(`+strconv.Quote(alone)+`, "shot.png")));
		result.aloneShown = await until(() => content().querySelectorAll(".cm-md-picture").length === 1);

		const html = '<meta charset="utf-8"><h2>粘贴标题</h2><p>一段 <strong>粗体</strong> 和 <a href="https://example.com/a">链接</a>，<a href="javascript:alert(1)">坏链接</a></p>'
			+ '<p><img src="data:image/png;base64,' + `+strconv.Quote(inside)+` + '"></p>'
			+ '<ul><li>第一项<ul><li>子项</li></ul></li><li>第二项</li></ul>'
			+ '<pre><code class="language-go">fmt.Println("hi")\n  x := 1\n</code></pre>'
			+ '<table><tr><th>名</th><th>值</th></tr><tr><td>a</td><td>1</td></tr></table>';
		paste((dt) => {
			dt.setData("text/html", html);
			dt.setData("text/plain", "粘贴标题 一段 粗体");
		});
		result.insideShown = await until(() => content().querySelectorAll(".cm-md-picture").length === 2);

		paste((dt) => {
			dt.setData("text/html", "<b>纯文本</b>");
			dt.setData("text/plain", "纯文本X");
		});
		result.plainShown = await until(() => content().textContent.includes("纯文本X"));
		content().blur();
		return result;
	`)
	if err != nil {
		return result, err
	}
	for _, k := range []string{"rowShown", "editorShown", "aloneShown", "insideShown", "plainShown"} {
		if result[k] != true {
			return result, errors.New("paste: " + k + " failed: " + jsonString(result))
		}
	}

	id, _ := result["itemId"].(float64)
	var note string
	for i := 0; i < 50; i++ { // the note saves as the typing pauses
		it, err := db.Item(int64(id))
		if err != nil {
			return result, err
		}
		note = it.Note
		if strings.Contains(note, "纯文本X") {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	result["note"] = note
	for _, want := range []string{
		"## 粘贴标题",
		"一段 **粗体** 和 [链接](https://example.com/a)，坏链接",
		"- 第一项\n  - 子项\n- 第二项",
		"```go\nfmt.Println(\"hi\")\n  x := 1\n```",
		"| 名 | 值 |\n| --- | --- |\n| a | 1 |",
		"纯文本X",
	} {
		if !strings.Contains(note, want) {
			return result, errors.New("paste: the note lacks " + strconv.Quote(want) + ": " + strconv.Quote(note))
		}
	}
	if n := len(imageName.FindAllString(note, -1)); n != 2 {
		return result, errors.New("paste: the note refers to " + strconv.Itoa(n) + " pictures, want 2: " + strconv.Quote(note))
	}
	if strings.Contains(note, "**纯文本**") || strings.Contains(note, "javascript:") {
		return result, errors.New("paste: unexpected Markdown: " + strconv.Quote(note))
	}
	for _, m := range imageName.FindAllStringSubmatch(note, -1) {
		if _, err := os.Stat(filepath.Join(imageDir(a.dataDir), m[1])); err != nil {
			return result, err
		}
	}
	if err := a.atlas.DeleteItem(int64(id)); err != nil {
		return result, err
	}
	return result, nil
}

// smokeImmersive opens the immersive dialog of a note in the webview: it
// shows the item's title, the outline of the note's headings and its
// counts, folds and the find panel are there, and Escape closes it.
func (a *app) smokeImmersive(main *mygo.Window) (map[string]any, error) {
	result, err := mygo.EvalAs[map[string]any](main.Page(), `
		const until = async (check) => {
			for (let i = 0; i < 100; i++) {
				if (check()) return true;
				await new Promise((r) => setTimeout(r, 100));
			}
			return false;
		};
		const result = {};
		const project = (await mygo.call("Atlas.Projects")).find((p) => p.name === "冒烟测试项目");
		const item = await mygo.call("Atlas.CreateItem", {
			projectId: project.id, parentId: 0, moduleId: 0, type: "feature", title: "冒烟沉浸条目",
			note: "# 第一章\n\n正文 hello world\n\n## 第二节\n\n更多",
		});
		result.itemId = item.id;
		const row = () => document.querySelector('[data-item-id="' + item.id + '"]');
		result.rowShown = await until(() => !!row());
		row()?.click();
		const open = () => document.querySelector('[aria-label="沉浸式编辑"]');
		result.buttonShown = await until(() => !!open());
		open()?.click();
		const dialog = () => document.querySelector('[role="dialog"]');
		result.dialogShown = await until(() => !!dialog()?.querySelector(".immersive-editor .cm-content"));
		result.title = dialog()?.querySelector("[data-immersive-title]")?.value ?? "";
		const outline = () => [...(dialog()?.querySelectorAll('nav[aria-label="大纲"] li') ?? [])].map((li) => li.textContent.trim());
		result.outlineShown = await until(() => outline().length === 2);
		result.outline = outline();
		result.counts = dialog()?.querySelector("footer")?.textContent ?? "";
		result.folds = !!dialog()?.querySelector(".cm-foldGutter");
		document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		result.closed = await until(() => !dialog());
		return result;
	`)
	if err != nil {
		return result, err
	}
	for _, k := range []string{"rowShown", "buttonShown", "dialogShown", "outlineShown", "folds", "closed"} {
		if result[k] != true {
			return result, errors.New("immersive: " + k + " failed: " + jsonString(result))
		}
	}
	counts, _ := result["counts"].(string)
	if result["title"] != "冒烟沉浸条目" || !strings.Contains(counts, "12 字") || !strings.Contains(counts, "7 行") {
		return result, errors.New("immersive: unexpected title or counts: " + jsonString(result))
	}
	id, _ := result["itemId"].(float64)
	if err := a.atlas.DeleteItem(int64(id)); err != nil {
		return result, err
	}
	return result, nil
}
