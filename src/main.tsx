import "@tinycloud/styles";
import "@xyflow/react/dist/style.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createExplorerDataSource } from "./data/createExplorerDataSource";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App dataSource={createExplorerDataSource()} />
  </StrictMode>,
);
