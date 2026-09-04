import type { QuestionMedia } from "@shared/protocol";
import { resolveMediaUrl, youTubeEmbedUrl, youTubeId } from "../media";

/**
 * Renders the media that accompanies a question — an image, or an embedded
 * YouTube clip. `size` tips the layout: the host screen ("stage") gets a taller
 * frame than a player's phone ("phone").
 *
 * There is deliberately no `<video>` branch. A self-hosted clip would be pulled
 * from our own box by every phone in the room at once, competing with the
 * WebSocket traffic the game runs on; YouTube's CDN does that job for free. The
 * API rejects any non-YouTube video URL, so the fallback below is only ever
 * reached by a row saved before that rule existed.
 */
export function Media({
  media,
  size = "stage",
}: {
  media: QuestionMedia;
  size?: "stage" | "phone";
}) {
  if (media.kind === "none") return null;

  if (media.kind === "image") {
    return (
      <figure className={`q-media q-media-${size}`}>
        <img src={resolveMediaUrl(media.url)} alt="" loading="eager" />
      </figure>
    );
  }

  const id = youTubeId(media.url);
  if (id) {
    return (
      <figure className={`q-media q-media-${size} is-video`}>
        <iframe
          src={youTubeEmbedUrl(id)}
          title="Question video"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </figure>
    );
  }

  // Not a YouTube link — offer it as a link rather than a broken frame.
  return (
    <p className="q-media-link">
      <a href={media.url} target="_blank" rel="noreferrer">
        Open video ↗
      </a>
    </p>
  );
}
