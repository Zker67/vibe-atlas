package main

import (
	"errors"

	"github.com/egoist/mygo"
)

// orgChecks are the checks of smokeOrgs, each true when it passed.
var orgChecks = []string{"personalShown", "listed", "switches", "othersHidden", "recorded", "createdInOrg", "deletable", "backHome", "deleted"}

// smokeOrgs switches organizations from the title bar: it shows 个人 in
// place of the app's name; a new organization is in its list, and picking
// it leaves the sidebar without the projects of 个人; a project created
// there goes to it; back in 个人, the project open before opens again.
// Deleting the organization moves its project to 个人.
func (a *app) smokeOrgs(main *mygo.Window) (map[string]any, error) {
	result, err := mygo.EvalAs[map[string]any](main.Page(), `
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const until = async (check, ms = 3000) => {
			for (let t = 0; t < ms; t += 50) {
				if (await check()) return true;
				await sleep(50);
			}
			return false;
		};
		const bar = () => document.querySelector("[data-titlebar]");
		const aside = () => document.querySelector("aside");
		const menu = () => document.querySelector('[role="menu"][data-state="open"]');
		const menuItem = (label) => [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].find((el) => el.textContent.includes(label));
		// The switcher opens as the left button goes down on it.
		const openMenu = () => {
			const el = document.querySelector("[data-org-switcher]");
			const r = el.getBoundingClientRect();
			el.dispatchEvent(new PointerEvent("pointerdown", {
				bubbles: true, cancelable: true, composed: true, pointerId: 52, pointerType: "mouse", isPrimary: true,
				clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1,
			}));
			return until(() => menu());
		};
		// The menu open, its item; something taking the focus as a project opens closes the menu, so it opens again.
		const pick = async (label) => {
			if (!menu()) await openMenu();
			const item = menuItem(label);
			item?.click();
			return !!item && (await until(() => !menu()));
		};
		const active = () => [...aside().querySelectorAll('[data-active="true"]')].map((el) => el.textContent);
		const home = "冒烟测试项目";
		const out = {};

		const personal = (await mygo.call("Atlas.Orgs")).find((o) => o.personal);
		out.personalShown = !!personal && (await until(() => bar().textContent.includes(personal.name))) && !bar().textContent.includes("Vibe Atlas");
		const org = await mygo.call("Atlas.CreateOrg", { name: "冒烟组织", icon: "" });
		out.listed = (await until(async () => {
			if (!menu()) await openMenu();
			return !!menuItem("冒烟组织");
		})) && !!menuItem("新建组织") && !menuItem("删除组织");
		out.switches = (await pick("冒烟组织")) && (await until(() => bar().textContent.includes("冒烟组织")));
		out.othersHidden = await until(() => !aside().textContent.includes(home) && document.body.innerText.includes("「冒烟组织」还没有项目"));
		out.recorded = await until(async () => (await mygo.call("Atlas.Settings")).currentOrgId === org.id);
		const made = await mygo.call("Atlas.CreateProject", "冒烟组织项目");
		out.createdInOrg = made.orgId === org.id && (await until(() => active().some((t) => t.includes("冒烟组织项目"))));
		out.deletable = await until(async () => {
			if (!menu()) await openMenu();
			return !!menuItem("删除组织");
		});
		out.backHome = (await pick(personal.name)) &&
			(await until(() => bar().textContent.includes(personal.name) && active().some((t) => t.includes(home)) && !aside().textContent.includes("冒烟组织项目")));
		const moved = await mygo.call("Atlas.DeleteOrg", org.id);
		out.deleted = moved === 1 && (await mygo.call("Atlas.Projects")).find((p) => p.id === made.id)?.orgId === personal.id;
		await mygo.call("Atlas.DeleteProject", made.id);
		return out;
	`)
	if err != nil {
		return nil, err
	}
	for _, k := range orgChecks {
		if result[k] != true {
			return result, errors.New("orgs: " + k + " failed: " + jsonString(result))
		}
	}
	return result, nil
}
