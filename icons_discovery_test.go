package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image/color"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestConfiguredProjectIcons(t *testing.T) {
	png := pngOf(t, 4, 4, color.White)
	cases := []struct {
		name, config, source, want string
	}{
		{"mygo", "mygo.config.ts", `import {defineConfig} from "mygo-cli"; export default defineConfig({ icon: "art/brand.png" });`, "art/brand.png"},
		{"mygo single quotes", "mygo.config.js", `export default defineConfig({icon: 'art/brand.png', windows: { icon: 'wrong.png' }});`, "art/brand.png"},
		{"mygo quoted key", "mygo.config.mjs", "export default defineConfig({ 'icon': `art/brand.png` });", "art/brand.png"},
		{"mygo comments", "mygo.config.ts", "// export default defineConfig({icon: 'wrong.png'})\nexport default defineConfig({ /* icon: 'wrong.png' */ icon: 'art/brand.png' });", "art/brand.png"},
		{"mygo dynamic", "mygo.config.ts", `export default defineConfig({icon: 'art/brand.png' + suffix});`, "icon.png"},
		{"mygo variable", "mygo.config.ts", `const icon = 'art/brand.png'; export default defineConfig({icon});`, "icon.png"},
		{"mygo spread", "mygo.config.ts", `export default defineConfig({icon: 'art/brand.png', ...other});`, "icon.png"},
		{"mygo interpolation", "mygo.config.ts", "export default defineConfig({icon: `art/${brand}.png`});", "icon.png"},
		{"mygo nested unrelated", "mygo.config.ts", `export default defineConfig({ windows: { icon: 'art/brand.png' }});`, "icon.png"},
		{"mygo commented only", "mygo.config.ts", `/* export default defineConfig({ icon: 'art/brand.png' }); */`, "icon.png"},
		{"mygo invalid", "mygo.config.ts", `export default defineConfig({ icon: 'art/brand.png'`, "icon.png"},
		{"mygo escaping", "mygo.config.ts", `export default defineConfig({icon: '../art/brand.png'});`, "icon.png"},
		{"godot", "project.godot", "[application]\nconfig/icon=\"res://art/brand.png\"\n[other]\nconfig/icon=\"res://wrong.png\"", "art/brand.png"},
		{"godot comment", "project.godot", "[application]\nconfig/icon=\"res://art/brand.png\" ; icon\n", "art/brand.png"},
		{"godot wrong section", "project.godot", "[other]\nconfig/icon=\"res://art/brand.png\"", "icon.png"},
		{"godot escape", "project.godot", "[application]\nconfig/icon=\"res://../art/brand.png\"", "icon.png"},
		{"godot external", "project.godot", "[application]\nconfig/icon=\"https://example.org/art/brand.png\"", "icon.png"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			folder := project(t, map[string][]byte{tc.config: []byte(tc.source), "art/brand.png": png, "icon.png": png})
			if _, rel := findProjectIcon(folder); rel != tc.want {
				t.Fatalf("got %q, want %q", rel, tc.want)
			}
		})
	}
	for _, stem := range []string{"app_icon", "assets/app-icon", "assets/app_icon", "public/app-icon", "resources/app_icon"} {
		t.Run(stem, func(t *testing.T) {
			if _, rel := findProjectIcon(project(t, map[string][]byte{stem + ".png": png})); rel != stem+".png" {
				t.Fatal(rel)
			}
		})
	}
	// A declared brand wins over a stale conventional favicon.
	folder := project(t, map[string][]byte{"index.html": []byte(`<link rel="icon" href="/brand.png">`), "public/brand.png": png, "favicon.png": png})
	if _, rel := findProjectIcon(folder); rel != "public/brand.png" {
		t.Fatal(rel)
	}
}

func TestWorkspaceIconDiscovery(t *testing.T) {
	png := pngOf(t, 4, 4, color.White)
	cases := []struct {
		name, file, source, want string
	}{
		{"npm", "package.json", `{"workspaces":["apps/*"]}`, "apps/a/icon.png"},
		{"yarn", "package.json", `{"workspaces":{"packages":["apps/*"]}}`, "apps/a/icon.png"},
		{"exclude", "package.json", `{"workspaces":["apps/*","!apps/a"]}`, "apps/b/public/favicon.webp"},
		{"globstar", "package.json", `{"workspaces":["apps/**","!**/a"]}`, "apps/b/public/favicon.webp"},
		{"literal", "package.json", `{"workspaces":["apps/b"]}`, "apps/b/public/favicon.webp"},
		{"invalid json", "package.json", `{"workspaces":`, ""},
		{"outside", "package.json", `{"workspaces":["../*","C:/apps/*","/apps/*"]}`, ""},
		{"pnpm", "pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n  - '!apps/a' # disabled\nignored:\n  - 'other/*'", "apps/b/public/favicon.webp"},
		{"pnpm double quoted", "pnpm-workspace.yaml", "packages:\n- \"apps/*\" # apps\n- \"!apps/a\"", "apps/b/public/favicon.webp"},
		{"pnpm bare", "pnpm-workspace.yaml", "packages:\n  - apps/b # web\n", "apps/b/public/favicon.webp"},
		{"pnpm inline", "pnpm-workspace.yaml", `packages: ["apps/b"]`, "apps/b/public/favicon.webp"},
		{"pnpm unsupported exclusion", "pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n  - !custom exclusion", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			folder := project(t, map[string][]byte{
				tc.file: []byte(tc.source), "apps/a/package.json": []byte(`{}`), "apps/a/icon.png": png,
				"apps/b/package.json": []byte(`{}`), "apps/b/public/favicon.webp": webpData,
				"apps/not-an-app/icon.png": png,
			})
			if _, rel := findProjectIcon(folder); rel != tc.want {
				t.Fatalf("got %q, want %q", rel, tc.want)
			}
		})
	}
	folder := project(t, map[string][]byte{
		"package.json":   []byte(`{"workspaces":["**","!a","!excluded/**"]}`),
		"a/package.json": []byte(`{}`), "a/icon.png": png,
		"node_modules/package.json": []byte(`{}`), "node_modules/icon.png": png,
		"Library/x/package.json": []byte(`{}`), "Library/x/icon.png": png,
		"excluded/app/package.json": []byte(`{}`), "excluded/app/icon.png": png,
	})
	if _, rel := findProjectIcon(folder); rel != "" {
		t.Fatalf("excluded directory detected: %s", rel)
	}
}

func TestUnityIconDiscoveryAndCache(t *testing.T) {
	const guid = "8580199502cab304fb7d41877aca0549"
	const other = "11111111111111111111111111111111"
	png := pngOf(t, 4, 4, color.White)
	settings := "PlayerSettings:\n  m_BuildTargetIcons:\n  - m_BuildTarget: Standalone\n    m_Icons:\n    - m_Icon: {fileID: 2800000, guid: " + other + ", type: 3}\n  - m_BuildTarget: \n    m_Icons:\n    - m_Icon: {fileID: 2800000, guid: " + guid + ", type: 3}\n  unrelated: {guid: 22222222222222222222222222222222}\n"
	folder := project(t, map[string][]byte{
		"ProjectSettings/ProjectSettings.asset": []byte(settings),
		"Assets/Brand/brand.png":                png, "Assets/Brand/brand.png.meta": []byte("fileFormatVersion: 2\nguid: " + guid + "\n"),
		"Assets/desktop.png": png, "Assets/desktop.png.meta": []byte("guid: " + other + "\n"),
		"Assets/Plugins/icon.png": png,
	})
	for range 2 {
		if _, rel := findProjectIcon(folder); rel != "Assets/Brand/brand.png" {
			t.Fatalf("default before desktop, also when cached: %s", rel)
		}
	}
	for _, ext := range []string{"", ".meta"} {
		if err := os.Rename(filepath.Join(folder, "Assets/Brand/brand.png"+ext), filepath.Join(folder, "Assets/renamed.png"+ext)); err != nil {
			t.Fatal(err)
		}
	}
	if _, rel := findProjectIcon(folder); rel != "Assets/renamed.png" {
		t.Fatalf("stale cache not invalidated: %s", rel)
	}
	if err := os.WriteFile(filepath.Join(folder, "Assets/renamed.png"), []byte("invalid image"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, rel := findProjectIcon(folder); rel != "Assets/desktop.png" {
		t.Fatalf("invalid default should fall back to desktop: %s", rel)
	}
	modern := "PlayerSettings:\n  m_BuildTargetPlatformIcons:\n  - m_BuildTarget: Android\n    m_Icons:\n    - m_Textures:\n      - {fileID: 2800000, guid: " + guid + ", type: 3}\n      m_Kind: 2\n  someTexture: {guid: " + other + "}\n"
	refs := unityIconGUIDs(modern)
	if len(refs) != 1 || refs[0].guid != guid {
		t.Fatalf("platform texture refs: %+v", refs)
	}
	if refs := unityIconGUIDs("PlayerSettings:\n  unrelated: {guid: " + guid + "}\n"); len(refs) != 0 {
		t.Fatal(refs)
	}
}

func TestIconDiscoveryConfinement(t *testing.T) {
	png := pngOf(t, 4, 4, color.White)
	outside := project(t, map[string][]byte{"icon.png": png, "package.json": []byte(`{}`)})
	folder := project(t, map[string][]byte{"package.json": []byte(`{"workspaces":["linked"]}`)})
	if err := os.Symlink(outside, filepath.Join(folder, "linked")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if err := os.Symlink(filepath.Join(outside, "icon.png"), filepath.Join(folder, "icon.png")); err != nil {
		t.Fatal(err)
	}
	if _, rel := findProjectIcon(folder); rel != "" {
		t.Fatalf("followed external link: %s", rel)
	}
	for _, rel := range []string{"../icon.png", `..\icon.png`, "linked/icon.png", "C:/icon.png", "/icon.png", "file:///icon.png"} {
		if data := readIconFile(folder, rel); data != nil {
			t.Errorf("read outside via %q", rel)
		}
	}
}

func TestWorkspaceDiscoveryLimits(t *testing.T) {
	files := map[string][]byte{"package.json": []byte(`{"workspaces":["apps/*","deep/**"]}`)}
	for i := range maxIconAppDirs + 10 {
		files[fmt.Sprintf("apps/%03d/package.json", i)] = []byte(`{}`)
	}
	files["deep/"+strings.Repeat("nested/", 9)+"package.json"] = []byte(`{}`)
	dirs := workspaceAppDirs(project(t, files))
	if len(dirs) != maxIconAppDirs || !slices.IsSorted(dirs) {
		t.Fatalf("unbounded/unstable workspace list: %v", dirs)
	}
	delete(files, "package.json")
	files["package.json"] = []byte(`{"workspaces":["deep/**"]}`)
	if dirs := workspaceAppDirs(project(t, files)); len(dirs) != 0 {
		t.Fatalf("exceeded depth: %v", dirs)
	}
}

// Opt-in real-project verification, without committing machine paths or
// writing into the projects/app database. All saved images use t.TempDir.
func TestProjectIconDiscoveryLocal(t *testing.T) {
	raw := os.Getenv("VIBE_ATLAS_ICON_PROJECTS")
	if raw == "" {
		t.Skip("set VIBE_ATLAS_ICON_PROJECTS to a JSON array of {folder,want}")
	}
	var projects []struct{ Folder, Want string }
	if err := json.Unmarshal([]byte(raw), &projects); err != nil {
		t.Fatal(err)
	}
	for _, p := range projects {
		t.Run(filepath.Base(p.Folder), func(t *testing.T) {
			started := time.Now()
			data, rel := findProjectIcon(p.Folder)
			t.Logf("found %q in %s", rel, time.Since(started))
			if rel != p.Want {
				t.Fatalf("want %q", p.Want)
			}
			if rel != "" {
				if _, err := saveIcon(t.TempDir(), data); err != nil {
					t.Fatal(err)
				}
				again, againRel := findProjectIcon(p.Folder)
				if againRel != rel || !bytes.Equal(again, data) {
					t.Fatal("unstable repeated detection")
				}
			}
		})
	}
}
