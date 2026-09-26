import { Link } from "react-router";

export default function NotFound() {
  return (
    <main className="landing">
      <h1>Baantwise</h1>
      <p className="tagline">We couldn't find that page.</p>
      <Link to="/" className="button secondary">
        Go to the home page
      </Link>
    </main>
  );
}
