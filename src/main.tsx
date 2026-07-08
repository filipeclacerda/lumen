import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { App } from "./app/App";
import { initTheme } from "./shared/theme";
import { initZoom } from "./shared/zoom";
import { ToastProvider } from "./shared/ui/toast";
import "./styles.css";
initTheme();
initZoom();
const queryClient = new QueryClient();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><ToastProvider><BrowserRouter><App/></BrowserRouter></ToastProvider></QueryClientProvider></React.StrictMode>
);

// The window starts hidden (`visible: false` in tauri.conf.json) to avoid a white
// flash before the WebView finishes loading; reveal it after the first paint.
if ("__TAURI_INTERNALS__" in window) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const win = getCurrentWindow();
      void win.show().then(() => win.setFocus()).catch(() => {});
    });
  });
}
