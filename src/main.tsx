import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { AuthProvider } from "./lib/auth";
// Fonts served from our own site (no font requests to Google). Schibsted Grotesk is
// for reading; Shantell Sans (a marker pen) is for titles and money; Caveat (a quick
// pen) is for handwritten notes; Kalam only draws the word "बाँट" on the landing page.
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/shantell-sans/full.css";
import "@fontsource-variable/caveat";
import "@fontsource/kalam/devanagari-700.css";
import "./index.css";
import { beginSplash } from "./lib/splash";

beginSplash();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
