import { useState } from "react";
import { initialOf } from "../lib/format";

// A round Google photo, or the first letter of the name if there's no photo
// (or the photo doesn't load).
export function Avatar({ name, url, size = 40 }: { name: string; url: string | null; size?: number }) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  if (url && url !== brokenUrl) {
    return (
      <img
        className="avatar"
        src={url}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBrokenUrl(url)}
      />
    );
  }
  return (
    <span
      className="avatar avatar-initial"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden="true"
    >
      {initialOf(name)}
    </span>
  );
}
