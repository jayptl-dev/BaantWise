import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { scanningAvailable, scanReceipt, type ScannedReceipt } from "../lib/receiptScan";
import { PhotoProblem, shrinkPhoto } from "../lib/shrinkPhoto";

type ScanReceiptProps = {
  disabled: boolean;
  // A receipt was read. `photo` is the shrunk photo, to keep as the receipt photo.
  onScanned: (receipt: ScannedReceipt, photo: Blob) => void;
};

// "Scan receipt" at the top of Add expense. Shrinks the photo the same way receipt
// photos are (shrinkPhoto), sends it to be read, and hands back what was found.
export function ScanReceipt({ disabled, onScanned }: ScanReceiptProps) {
  const [available, setAvailable] = useState<boolean | null>(null); // null = still asking
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    scanningAvailable().then((open) => {
      if (active) setAvailable(open);
    });
    return () => {
      active = false;
    };
  }, []);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // so choosing the same photo again still works
    if (!file) return;
    setProblem(null);
    setReading(true);
    try {
      const photo = await shrinkPhoto(file);
      const result = await scanReceipt(photo);
      if ("problem" in result) setProblem(result.problem);
      else onScanned(result.receipt, photo);
    } catch (error) {
      setProblem(
        error instanceof PhotoProblem
          ? error.message
          : "We couldn't open that photo. Try taking it again, or choose a JPG or PNG.",
      );
    } finally {
      setReading(false);
    }
  }

  if (available === null) return null;
  if (!available) {
    return (
      <p className="scan-box muted">
        <span aria-hidden="true">🧾</span> Receipt scanning is coming soon
      </p>
    );
  }

  return (
    <div className="scan-box">
      {/* No "capture", so phones offer both the camera and the gallery. */}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={choose}
      />
      <button
        type="button"
        className="button secondary"
        onClick={() => input.current?.click()}
        disabled={disabled || reading}
      >
        <span aria-hidden="true">🧾</span> {reading ? "Reading your receipt…" : "Scan receipt"}
      </button>
      {reading && (
        <p className="visually-hidden" role="status">
          Reading your receipt…
        </p>
      )}
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      <p className="hint">Scanning sends the photo to Google Gemini to read it.</p>
    </div>
  );
}
