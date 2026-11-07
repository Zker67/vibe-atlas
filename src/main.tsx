import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { syncDarkClass } from "@/lib/theme";
import "./index.css";

syncDarkClass();

// Both windows load this page: /capture is the quick capture panel, which
// loads only its own code so that it is ready quickly.
const capture = location.pathname.replace(/\/+$/, "") === "/capture";
// The panel is as tall as its content (index.css), which its window takes.
if (capture) document.documentElement.dataset.capture = "";
const app: Promise<ComponentType> = capture
  ? import("./capture-app").then((m) => m.CaptureApp)
  : import("./main-app").then((m) => m.MainApp);

void app.then((App) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
