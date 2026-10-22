import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./reset.css";
import "./mosaic/base.css";
import "./app.css";

createRoot(document.getElementById("app")!).render(<App />);
