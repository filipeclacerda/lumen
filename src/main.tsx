import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { initTheme } from "./shared/theme";
import { ToastProvider } from "./shared/ui/toast";
import "./styles.css";
initTheme();
const queryClient = new QueryClient();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><ToastProvider><BrowserRouter><App/></BrowserRouter></ToastProvider></QueryClientProvider></React.StrictMode>
);
