package main

import (
	"errors"

	"github.com/egoist/mygo"
)

// smokeOpenAtLogin is the smoke test of VIBE_ATLAS_SMOKE_LOGIN=1: the page
// turns starting at login on and off again, and the system says the same
// each time. It runs only while it is off, and leaves it off, so that the
// user's own setting is never touched.
func (a *app) smokeOpenAtLogin(main *mygo.Window) (map[string]any, error) {
	if mygo.App.OpenAtLogin() {
		return nil, errors.New("开机自动启动已经打开：关掉后再测，测试不改动用户自己的设置")
	}
	result, err := mygo.EvalAs[map[string]any](main.Page(), `
		const before = await mygo.call("Atlas.Settings");
		const on = await mygo.call("Atlas.SetOpenAtLogin", true);
		const read = await mygo.call("Atlas.Settings");
		const off = await mygo.call("Atlas.SetOpenAtLogin", false);
		return { can: before.canOpenAtLogin, before: before.openAtLogin, on: on.openAtLogin, read: read.openAtLogin, off: off.openAtLogin };
	`)
	if err != nil {
		_ = mygo.App.SetOpenAtLogin(false)
		return nil, err
	}
	result["systemAfter"] = mygo.App.OpenAtLogin()
	if result["can"] != true || result["before"] != false || result["on"] != true || result["read"] != true ||
		result["off"] != false || result["systemAfter"] != false {
		_ = mygo.App.SetOpenAtLogin(false)
		return result, errors.New("unexpected results: " + jsonString(result))
	}
	return result, nil
}
