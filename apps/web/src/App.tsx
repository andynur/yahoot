import { Footer } from "./components/Footer";
import { usePath } from "./router";
import { Home } from "./views/Home";
import { Host } from "./views/Host";
import { Player } from "./views/Player";

function View() {
  const path = usePath();
  if (path.startsWith("/host")) return <Host />;
  if (path.startsWith("/play") || path.startsWith("/join")) return <Player />;
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
