/**
 * Putting the podium on the clipboard.
 *
 * Two constraints shape this.
 *
 * The user gesture: browsers only allow a clipboard write from inside a click,
 * and creating the share link plus drawing the card both take a turn of the
 * event loop. Awaiting them first would move the write outside the gesture and
 * Safari refuses it there. `ClipboardItem` accepts a *promise* per flavour for
 * exactly this reason, so `write()` is called synchronously in the handler and
 * the browser waits on the work — which is why nothing is awaited before it.
 *
 * The secure context: `navigator.clipboard` does not exist on a plain http://
 * origin, and a teacher hosting this on the school LAN is on
 * http://192.168.x.x — the common case, not an edge case. Text still has the
 * old execCommand path; an image has none, so there the card is saved as a file
 * instead and the caller says so.
 */
export interface CardPayload {
  blob: Blob;
  text: string;
}

/**
 * `image-and-text` — both flavours landed. A chat app takes the picture when
 * pasted into the message box and the text when pasted into a caption field.
 * `text-only` — the browser would not take an image; the recap still copied.
 * `unavailable` — the clipboard is not usable at all here.
 */
export type CopyOutcome = "image-and-text" | "text-only" | "unavailable";

/** Pre-clipboard-API copy. Still the only thing that works over plain http. */
function legacyCopyText(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // Off-screen but focusable; `display:none` would not be selectable.
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

/** Copy plain text, falling back for insecure origins. Reports success. */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or not focused — try the old way below.
    }
  }
  return legacyCopyText(text);
}

function textBlob(text: string): Blob {
  return new Blob([text], { type: "text/plain" });
}

function copyTextOnly(payload: Promise<CardPayload>): Promise<CopyOutcome> {
  return payload.then(async (p) =>
    (await copyText(p.text)) ? "text-only" : "unavailable",
  );
}

/**
 * Not async on purpose: the body must run synchronously inside the click.
 * Pass the still-pending payload, not an awaited one.
 *
 * Rejects only if the payload itself failed (network, auth). A clipboard the
 * browser will not let us use is a reported outcome, not an error.
 */
export function copyCard(payload: Promise<CardPayload>): Promise<CopyOutcome> {
  const supportsImage =
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function";

  if (!supportsImage) return copyTextOnly(payload);

  let item: ClipboardItem;
  try {
    item = new ClipboardItem({
      "image/png": payload.then((p) => p.blob),
      "text/plain": payload.then((p) => textBlob(p.text)),
    });
  } catch {
    // Some engines reject promise-valued entries outright.
    return copyTextOnly(payload);
  }

  return navigator.clipboard
    .write([item])
    .then(() => "image-and-text" as const)
    .catch(() => copyTextOnly(payload));
}
