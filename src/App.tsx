import { Route, Routes } from "react-router";
import { SignedInPage } from "./components/AppLayout";
import GroupPage from "./pages/GroupPage";
import GroupSettings from "./pages/GroupSettings";
import Home from "./pages/Home";
import InvitePage from "./pages/InvitePage";
import NotFound from "./pages/NotFound";

// Which screen shows for which address. Cloudflare sends every address to this
// app (single-page-application mode), and React Router picks the screen.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/groups/:id"
        element={
          <SignedInPage>
            <GroupPage />
          </SignedInPage>
        }
      />
      <Route
        path="/groups/:id/settings"
        element={
          <SignedInPage>
            <GroupSettings />
          </SignedInPage>
        }
      />
      <Route path="/join/:token" element={<InvitePage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
