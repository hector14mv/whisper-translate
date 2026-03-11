import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { RecordingOverlay } from "./components/RecordingOverlay";
import "./index.css";

const currentWindow = getCurrentWindow();
const isOverlay = currentWindow.label === "overlay";

if (isOverlay) {
  document.body.classList.add("overlay-window");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? <RecordingOverlay /> : <App />}
  </React.StrictMode>,
);
