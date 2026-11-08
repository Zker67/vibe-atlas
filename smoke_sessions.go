package main

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/egoist/mygo"

	"github.com/Zker67/vibe-atlas/internal/sessions"
)

// smokeSessionID is the Claude Code session the smoke test links an item to.
const smokeSessionID = "5a5e5510-0000-4000-8000-000000000001"

// smokeSessions checks picking a local session in the webview: with no
// source set there is nothing to pick; with Claude Code set, the detail
// lists a session made for the test, picking it links the item, and the
// link shows the session's name. The sessions are read from a folder of
// the test's own, never from the user's.
func (a *app) smokeSessions(main *mygo.Window) (map[string]any, error) {
	root := filepath.Join(a.dataDir, "smoke-claude")
	path := filepath.Join(root, "projects", "C--smoke", smokeSessionID+".jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	line := `{"type":"user","cwd":"C:\\smoke","message":{"role":"user","content":"冒烟"}}` + "\n" +
		`{"type":"ai-title","aiTitle":"冒烟测试会话"}` + "\n"
	if err := os.WriteFile(path, []byte(line), 0o644); err != nil {
		return nil, err
	}
	os.Setenv("CLAUDE_CONFIG_DIR", root)

	result, err := mygo.EvalAs[map[string]any](main.Page(), `
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const until = async (check, ms = 5000) => {
			for (let t = 0; t < ms; t += 50) {
				if (await check()) return true;
				await sleep(50);
			}
			return false;
		};
		const button = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
		const project = (await mygo.call("Atlas.Projects")).find((p) => p.name === "冒烟测试项目");
		const item = await mygo.call("Atlas.CreateItem", { projectId: project.id, parentId: 0, moduleId: 0, type: "improve", title: "会话条" });
		const row = () => [...document.querySelectorAll("[data-queue-row]")].find((el) => el.textContent.includes("会话条"));
		const out = {};
		if (!(await until(() => row()))) return { error: "the row did not show" };
		row().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		if (!(await until(() => button("添加链接")))) return { error: "the detail did not show" };

		out.noneByDefault = (await mygo.call("Atlas.Settings")).sessionSource === "" && !button("选择会话");
		out.noneListed = (await mygo.call("Atlas.ListSessions", "", true)).length === 0;

		await mygo.call("Atlas.SetSessionSource", "claude");
		out.buttonShows = await until(() => button("选择会话"));
		const listed = await mygo.call("Atlas.ListSessions", "", true);
		out.listed = listed.length === 1 && listed[0].title === "冒烟测试会话" && listed[0].link === "claude-session:`+smokeSessionID+`";

		button("选择会话")?.click();
		const option = () => [...document.querySelectorAll("[data-session-picker] [role=option]")].find((el) => el.textContent.includes("冒烟测试会话"));
		out.pickerLists = await until(() => option());
		option()?.click();
		out.linked = await until(async () => (await mygo.call("Atlas.Items", project.id)).find((i) => i.id === item.id)?.deeplink === "claude-session:`+smokeSessionID+`");
		out.nameShows = await until(() => !button("添加链接") && [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "冒烟测试会话"));

		await mygo.call("Atlas.SetSessionSource", "");
		out.offAgain = await until(() => !button("选择会话"));
		await mygo.call("Atlas.DeleteItem", item.id);
		return out;
	`)
	if err != nil {
		return nil, err
	}
	if msg, ok := result["error"].(string); ok {
		return result, errors.New(msg)
	}
	for _, k := range []string{"noneByDefault", "noneListed", "buttonShows", "listed", "pickerLists", "linked", "nameShows", "offAgain"} {
		if result[k] != true {
			return result, errors.New("session check failed: " + k)
		}
	}
	if _, ok := sessions.ClaudeCwd(smokeSessionID); !ok {
		return result, errors.New("the session made for the test cannot be found to open")
	}
	return result, nil
}
