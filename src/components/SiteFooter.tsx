import { Link } from "react-router";

// The small line at the bottom of every page: the privacy policy and how to reach us.
// Google's sign-in review looks for the privacy link on the home page.
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link to="/privacy">Privacy</Link>
      <span aria-hidden="true">·</span>
      <a href="mailto:privacy@baantwise.com">Contact</a>
    </footer>
  );
}
