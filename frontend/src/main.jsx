import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { SessionProvider } from "@/features/auth/session-context";
import { ThemeProvider } from "@/features/app/theme-context";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
