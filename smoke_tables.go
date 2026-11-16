package main

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

// tableChecks are the checks of smokeTables, each true when it passed.
var tableChecks = []string{"rowShown", "rendered", "header", "body", "inline", "aligned", "sourceHidden", "tabbed"}

// smokeTables checks a table in a note in the webview: it shows as a table,
// its header and cells as written, the Markdown in its cells rendered and
// its columns aligned; Tab in a cell lines its Markdown up. The hidden
// window takes no focus, so the source the cursor brings back is not
// checked here.
func (a *app) smokeTables(main *mygo.Window) (map[string]any, error) {
	db, err := a.atlas.store()
	if err != nil {
		return nil, err
	}
	note := "表格：\n\n| 名称 | 数量 | 说明 |\n| :-- | --: | :-: |\n| **苹果** | 3 | `红` |\n| 梨 | 12 | [链接](https://example.com) |\n\n后面"
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
			projectId: project.id, parentId: 0, moduleId: 0, type: "improve", title: "冒烟表格", note: `+strconv.Quote(note)+`,
		});
		result.itemId = item.id;
		const row = () => document.querySelector('[data-item-id="' + item.id + '"]');
		result.rowShown = await until(() => !!row());
		row()?.click();
		const content = () => document.querySelector('[aria-label="备注"] .cm-content');
		const table = () => content()?.querySelector("table.cm-md-table");
		result.rendered = await until(() => !!table());
		const t = table();
		result.header = [...(t?.querySelectorAll("th") ?? [])].map((c) => c.textContent).join() === "名称,数量,说明";
		const cells = [...(t?.querySelectorAll("tbody td") ?? [])];
		result.body = cells.map((c) => c.textContent).join() === "苹果,3,红,梨,12,链接";
		result.inline = !!cells[0]?.querySelector("strong") && !!cells[2]?.querySelector("code") && cells[5]?.querySelector("[data-href]")?.dataset.href === "https://example.com";
		result.aligned = cells[1]?.dataset.align === "right" && cells[2]?.dataset.align === "center" && cells[0]?.dataset.align === "left";
		result.sourceHidden = !content().textContent.includes("| :--");

		// A click in a cell puts the cursor there; Tab goes on to the next, lining the table up.
		cells[0]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
		content().dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", keyCode: 9, bubbles: true, cancelable: true }));
		content().blur();
		return result;
	`)
	if err != nil {
		return result, err
	}
	id, _ := result["itemId"].(float64)
	// The third column is as wide as its link, 27; its header in the middle.
	want := "| 名称     | 数量 | " + strings.Repeat(" ", 11) + "说明" + strings.Repeat(" ", 12) + " |" +
		"\n| :------- | ---: | :" + strings.Repeat("-", 25) + ": |"
	var saved string
	for i := 0; i < 50; i++ { // the note saves as the typing pauses
		it, err := db.Item(int64(id))
		if err != nil {
			return result, err
		}
		saved = it.Note
		if strings.Contains(saved, want) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	result["note"] = saved
	result["tabbed"] = strings.Contains(saved, want)
	for _, k := range tableChecks {
		if result[k] != true {
			return result, errors.New("tables: " + k + " failed: " + jsonString(result))
		}
	}
	return result, a.atlas.DeleteItem(int64(id))
}
