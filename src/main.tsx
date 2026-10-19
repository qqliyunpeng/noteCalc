import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root 容器缺失");

// The app draws its own edit menus where they make sense (the editor and text
// fields). Everywhere else there is no native menu either: suppress the
// webview's page menu so tabs, the menu strip and the status bar do not look
// like a browser.
document.addEventListener("contextmenu", (event) => event.preventDefault(), true);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
