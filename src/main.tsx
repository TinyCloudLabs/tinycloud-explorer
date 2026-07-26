import "@tinycloud/styles";
import "@xyflow/react/dist/style.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { sdkMockDataSource } from "./data/sdkMockDataSource";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App dataSource={sdkMockDataSource} />
  </StrictMode>,
);
