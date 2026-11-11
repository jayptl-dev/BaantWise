import { Link } from "react-router";

// The Baantwise mark (the app icon: a receipt split in two) next to the name.
export function BrandMark({ size = 28 }: { size?: number }) {
  return <img className="brand-mark" src="/icon.svg" alt="" width={size} height={size} />;
}

// The name in the header: tap it to go home.
export function BrandLink() {
  return (
    <Link to="/" className="brand">
      <BrandMark />
      Baantwise
    </Link>
  );
}
