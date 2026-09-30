import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "../../app/static/styles.css";
import "../../app/static/report.css";
import "../../app/static/ui.css";
import "./workflow2.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);