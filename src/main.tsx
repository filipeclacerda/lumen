import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { initializeUiPreferences } from "./shared/uiPreferences";
import { ToastProvider } from "./shared/ui/toast";
import { WindowFrame } from "./shared/ui/WindowFrame";
import "@fontsource-variable/inter";
import "./styles.css";
initializeUiPreferences();
const queryClient = new QueryClient();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <WindowFrame>
            <App />
          </WindowFrame>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
