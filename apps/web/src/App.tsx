import { Footer } from "./components/Footer";
import { usePath } from "./router";
import { Home } from "./views/Home";
import { Host } from "./views/Host";
import { Player } from "./views/Player";
import { PublicResults } from "./views/PublicResults";

function View() {
  const path = usePath();
  if (path.startsWith("/host")) return <Host />;
  if (path.startsWith("/play") || path.startsWith("/join")) return <Player />;
  // Public, shareable result page — no auth, the token in the path is the key.
  if (path.startsWith("/r/")) return <PublicResults />;
  return <Home />;
}

export function App() {
  return (
    <>
      <View />
      <Footer />
    </>
  );
}
