import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { AuthProvider } from "./lib/auth";
// Fonts served from our own site (no font requests to Google). Schibsted Grotesk is
// for reading; Anek Latin (by Ek Type in India, with a width axis) is for titles and
// money; Anek Devanagari only draws the word "बाँट" on the landing page.
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/anek-latin/wdth.css";
import "@fontsource-variable/anek-devanagari";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
