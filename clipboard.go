package main

import (
	"net/http"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

// ClipboardContent is what is on the clipboard, for the page's own 粘贴:
// the page may not read the clipboard without asking the user.
type ClipboardContent struct {
	Text string `json:"text"`
	HTML string `json:"html"`
	// Images are the pictures on the clipboard: a picture copied, as PNG,
	// or else the picture files copied, as a paste in the page has them.
	Images []ClipboardImage `json:"images"`
}

// ClipboardImage is a picture on the clipboard.
type ClipboardImage struct {
	// Type is its MIME type, such as "image/png".
	Type string `json:"type"`
	Data []byte `json:"data"`
}

// ReadClipboard reads the clipboard for the page's own right-click menu,
// whose 粘贴 hands it to the field as a paste would.
func (a *Atlas) ReadClipboard() ClipboardContent {
	c := ClipboardContent{
		Text:   mygo.Clipboard.ReadText(),
		HTML:   mygo.Clipboard.ReadHTML(),
		Images: []ClipboardImage{},
	}
	if pic := mygo.Clipboard.ReadImage(); len(pic) > 0 {
		c.Images = append(c.Images, ClipboardImage{Type: "image/png", Data: pic})
		return c
	}
	if data, err := mygo.Clipboard.Read(transfer.FileList); err == nil {
		paths, _ := data.Files()
		c.Images = append(c.Images, imageFilesOf(paths)...)
	}
	return c
}

// imageFilesOf reads the pictures among the files at paths, at most as
// large as a picture may be; the other files are left out.
func imageFilesOf(paths []string) []ClipboardImage {
	out := []ClipboardImage{}
	for _, path := range paths {
		data, err := readImageFile(path)
		if err != nil || len(data) == 0 || len(data) > maxImageBytes {
			continue
		}
		if t := http.DetectContentType(data); imageExts[t] != "" {
			out = append(out, ClipboardImage{Type: t, Data: data})
		}
	}
	return out
}
