import { Route, Routes } from "react-router";
import { SignedInPage } from "./components/AppLayout";
import AddExpense from "./pages/AddExpense";
import EditExpense from "./pages/EditExpense";
import ExpenseDetails from "./pages/ExpenseDetails";
import ForwardedBills from "./pages/ForwardedBills";
import GroupPage from "./pages/GroupPage";
import GroupSettings from "./pages/GroupSettings";
import GroupSpending from "./pages/GroupSpending";
import Home from "./pages/Home";
import InvitePage from "./pages/InvitePage";
import MySpending from "./pages/MySpending";
import NotFound from "./pages/NotFound";
import Profile from "./pages/Profile";
import Recurring from "./pages/Recurring";
import RecurringEdit from "./pages/RecurringEdit";
import SearchExpenses from "./pages/SearchExpenses";

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
        path="/search"
        element={
          <SignedInPage line="Sign in to search your expenses.">
            <SearchExpenses />
          </SignedInPage>
        }
      />
      <Route
        path="/groups/:id/search"
        element={
          <SignedInPage>
            <SearchExpenses />
          </SignedInPage>
        }
      />
      <Route
        path="/spending"
        element={
          <SignedInPage line="Sign in to see your spending.">
            <MySpending />
          </SignedInPage>
        }
      />
      <Route
        path="/groups/:id/spending"
        element={
          <SignedInPage>
            <GroupSpending />
          </SignedInPage>
        }
      />
      <Route
        path="/groups/:id/recurring"
        element={
          <SignedInPage>
            <Recurring />
          </SignedInPage>
        }
      />
      <Route
        path="/groups/:id/recurring/new"
        element={
          <SignedInPage>
            <RecurringEdit />
          </SignedInPage>
        }
      />
      <Route
        path="/groups/:id/recurring/:ruleId/edit"
        element={
          <SignedInPage>
            <RecurringEdit />
          </SignedInPage>
        }
      />
      <Route
        path="/groups/:id/bills"
        element={
          <SignedInPage>
            <ForwardedBills />
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
      <Route
        path="/groups/:id/expenses/new"
        element={
          <SignedInPage>
            <AddExpense />
          </SignedInPage>
        }
      />
      <Route
        path="/groups/:id/expenses/:expenseId"
        element={
          <SignedInPage>
            <ExpenseDetails />
          </SignedInPage>
        }
      />
      <Route
        path="/groups/:id/expenses/:expenseId/edit"
        element={
          <SignedInPage>
            <EditExpense />
          </SignedInPage>
        }
      />
      <Route
        path="/profile"
        element={
          <SignedInPage line="Sign in to see your profile.">
            <Profile />
          </SignedInPage>
        }
      />
      <Route path="/join/:token" element={<InvitePage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
