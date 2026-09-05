import { useEffect, useState } from "react";
import { api } from "../api";
import {
  copyCard,
  copyText,
  type CardPayload,
  type CopyOutcome,
} from "../clipboard";
import { downloadBlob } from "../download";
import { buildRecap, renderShareCard, type CardInput } from "../shareCard";

type Status = "idle" | "working" | "done" | "error";

/**
 * "Share result" on the podium screen.
 *
 * One press does three things: publishes the results at a public link, draws
 * the podium as a PNG, and puts both the picture and a text recap on the
 * clipboard. The link is what students open later; the picture is what gets
 * pasted into the class chat.
 *
 * Publishing is deliberately not automatic at game end — the page carries every
 * student's nickname and score, so it waits for the teacher to ask.
 */
export function ShareResult({ pin }: { pin: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [card, setCard] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // A blob URL is a live handle — let it go when the image changes or unmounts.
  useEffect(() => {
    if (!card) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(card);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [card]);

  /**
   * Everything the clipboard needs. Started, not awaited, by the click handler:
   * awaiting here would put the clipboard write outside the user gesture and
   * Safari would refuse it. See ../clipboard.
   */
  async function prepare(): Promise<CardPayload> {
    const { token } = await api.shareResults(pin);
    const url = `${window.location.origin}/r/${token}`;
    setLink(url);

    // Read the results back rather than reusing the on-screen leaderboard: that
    // one is capped at ten rows, and the server knows the real player and
    // question counts.
    const data = await api.getPublicResults(token);
    const input: CardInput = {
      quizTitle: data.quizTitle,
      theme: data.theme,
      players: data.players,
      questionCount: data.questionCount,
      url,
      endedAt: data.endedAt ?? undefined,
    };
    const blob = await renderShareCard(input);
    setCard(blob);
    return { blob, text: buildRecap(input) };
  }

  const OUTCOME_NOTE: Record<CopyOutcome, string> = {
    "image-and-text":
      "Image copied — paste it into your chat, then paste again in the caption box for the recap.",
    "text-only":
      "Recap text copied. This browser would not copy the picture, so use “Save image” to attach it.",
    // Almost always a page served over plain http:// — the LAN case.
    unavailable:
      "This browser only allows copying on a secure (https) page. The link and image are ready below: use “Save image” and “Copy link”.",
  };

  function onShare(): void {
    setStatus("working");
    setNote("");
    copyCard(prepare())
      .then((outcome) => {
        setStatus("done");
        setNote(OUTCOME_NOTE[outcome]);
      })
      .catch((err: unknown) => {
        setStatus("error");
        setNote(err instanceof Error ? err.message : "could not share results");
      });
  }

  async function onStopSharing(): Promise<void> {
    try {
      await api.unshareResults(pin);
      setLink(null);
      setCard(null);
      setStatus("idle");
      setNote("Link withdrawn — it no longer opens.");
    } catch (err) {
      setNote(
        err instanceof Error ? err.message : "could not withdraw the link",
      );
    }
  }

  const busy = status === "working";

  return (
    <div className="share-result">
      <div className="share-actions">
        <button className="btn lg" onClick={onShare} disabled={busy}>
          {busy ? "Preparing…" : link ? "Copy again" : "Share result"}
        </button>
        {card && (
          <button
            className="btn ghost"
            onClick={() => downloadBlob(`yahoot-${pin}.png`, card)}
          >
            Save image
          </button>
        )}
      </div>

      {note && (
        <p className={`share-note${status === "error" ? " is-error" : ""}`}>
          {note}
        </p>
      )}

      {preview && (
        <img className="share-preview" src={preview} alt="The podium card" />
      )}

      {link && (
        <div className="share-link">
          <span className="share-link-label">Public link</span>
          <a href={link} target="_blank" rel="noreferrer">
            {link.replace(/^https?:\/\//, "")}
          </a>
          <div className="share-link-actions">
            <button
              className="btn ghost sm"
              onClick={() => {
                void copyText(link).then((ok) =>
                  setNote(
                    ok
                      ? "Link copied."
                      : "Could not reach the clipboard — select the link above and copy it.",
                  ),
                );
              }}
            >
              Copy link
            </button>
            <button
              className="btn ghost sm"
              onClick={() => void onStopSharing()}
            >
              Stop sharing
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
