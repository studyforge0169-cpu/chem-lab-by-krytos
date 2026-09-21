import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { registerShip } from "./lib/sw.js";
import "./styles/app.css";
import "./styles/hacker.css";

// a service worker only in the built copy: in dev it would cache the module graph mid-edit and
// the page you are looking at would not be the page you just changed
if (import.meta.env.PROD) registerShip();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
