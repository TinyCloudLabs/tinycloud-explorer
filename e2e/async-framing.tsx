import "@tinycloud/styles";
import "@xyflow/react/dist/style.css";
import "../src/styles.css";

import { createRoot } from "react-dom/client";
import { App } from "../src/App";
import type { ExplorerSnapshot, ExplorerSnapshotListener } from "../src/data/ExplorerDataSource";
import { SdkMockExplorerDataSource } from "../src/data/sdkMockDataSource";

declare global {
  interface Window {
    completeDiscovery: () => void;
  }
}

class StagedMockDataSource extends SdkMockExplorerDataSource {
  async connect(onSnapshot?: ExplorerSnapshotListener): Promise<ExplorerSnapshot> {
    const complete = await super.connect();
    const initial: ExplorerSnapshot = {
      ...complete,
      spaces: [{
        ...complete.spaces[0],
        resourceCount: 0,
        resources: [],
        discoveryState: "loading",
      }],
      discovery: {
        phase: "spaces",
        completedSpaces: 0,
        totalSpaces: complete.spaces.length,
      },
    };
    onSnapshot?.(initial);
    await new Promise<void>((resolve) => { window.completeDiscovery = resolve; });
    onSnapshot?.(complete);
    return complete;
  }
}

createRoot(document.getElementById("root")!).render(
  <App dataSource={new StagedMockDataSource()} />,
);
