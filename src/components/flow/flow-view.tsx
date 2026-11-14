import { useDefaultLayout } from "react-resizable-panels";
import { useAtlas } from "@/state/atlas";
import type { Project } from "@/mygo";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ItemDetail } from "@/components/app/item-detail";
import { ProjectBar } from "@/components/app/project-header";
import { FlowBoard } from "./flow-board";

/**
 * The flow chart of a project, with the project's bar atop it and, once
 * something is selected, the detail beside it, as the queue has them; with
 * nothing selected, the chart takes the room. Loaded only once it opens
 * (main-app.tsx), so that the window and quick capture start without it.
 */
export default function FlowView({ project }: { project: Project }) {
  const detail = useAtlas((s) => s.selectedId !== 0 || s.selectedIds.size > 0);
  const layout = useDefaultLayout({ id: "vibe-atlas-flow", panelIds: detail ? ["flow", "detail"] : ["flow"] });
  return (
    <ResizablePanelGroup className="min-h-0 flex-1" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
      <ResizablePanel id="flow" minSize={360} className="flex flex-col">
        <ProjectBar project={project} />
        <FlowBoard />
      </ResizablePanel>
      {detail && (
        <>
          <ResizableHandle />
          <ResizablePanel id="detail" defaultSize={360} minSize={300} maxSize="60%">
            <ItemDetail />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
