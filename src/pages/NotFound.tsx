import { Link } from "react-router";
import { BrandMark } from "../components/Brand";

export default function NotFound() {
  return (
    <main className="landing">
      <h1 className="wordmark">
        <BrandMark size={40} />
        Baantwise
      </h1>
      <p className="tagline">We couldn't find that page.</p>
      <Link to="/" className="button secondary">
        Go to the home page
      </Link>
    </main>
  );
}
