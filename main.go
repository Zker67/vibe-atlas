// Command vibe-atlas is Vibe Atlas, a local place for a solo developer to
// keep the improvements, bugs and new features of every vibe project.
package main

import (
	"log"
	"os"
	"path/filepath"

	"github.com/egoist/mygo"
)

func main() {
	a := &app{smokeReport: os.Getenv("VIBE_ATLAS_SMOKE_REPORT")}
	a.atlas = &Atlas{app: a}
	mygo.Bind(a.atlas)

	// `mygo generate` runs main up to App.Run to write the TypeScript
	// client: leave the user's data alone then.
	if os.Getenv("MYGO_GENERATE") == "" {
		dir, err := dataDir()
		if err != nil {
			log.Fatal(err)
		}
		a.dataDir = dir
		// Window positions go there too.
		mygo.App.SetPath(mygo.PathUserData, dir)
		if a.smokeReport == "" && !mygo.App.RequestSingleInstanceLock() {
			return // the running instance shows itself
		}
	}
	mygo.App.OnSecondInstance(func([]string, string) { a.showMain() })
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { a.setQuitting() })
	mygo.App.OnWindowAllClosed(func() {}) // keep running in the tray
	mygo.App.WhenReady(a.start)
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

// dataDir returns the folder of the database: VIBE_ATLAS_DATA_DIR when set,
// else the app's user data directory, with development builds kept apart
// in its dev folder.
func dataDir() (string, error) {
	dir := os.Getenv("VIBE_ATLAS_DATA_DIR")
	if dir == "" {
		base, err := mygo.App.Path(mygo.PathUserData)
		if err != nil {
			return "", err
		}
		dir = base
		if mygo.IsDev() {
			dir = filepath.Join(base, "dev")
		}
	}
	return dir, os.MkdirAll(dir, 0o755)
}
