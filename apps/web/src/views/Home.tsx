import { useState } from "react";
import { normalizePin } from "@shared/wire";
import { navigate } from "../router";

export function Home() {
  const [pin, setPin] = useState("");

  return (
    <div className="screen center">
      <h1 className="brand">
        <span className="k">Y</span>ahoot
      </h1>
      <p className="tagline">Host on the big screen · play on your phone</p>

      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          const clean = normalizePin(pin);
          if (clean) navigate(`/play?pin=${encodeURIComponent(clean)}`);
        }}
      >
        <label className="label" htmlFor="pin">
          Game PIN
        </label>
        <input
          id="pin"
          className="input big"
          inputMode="numeric"
          autoComplete="off"
          placeholder="123 456"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        <button className="btn dark block lg" type="submit">
          Enter
        </button>
      </form>

      <button className="link" onClick={() => navigate("/host")}>
        I&apos;m the teacher — host a game
      </button>
    </div>
  );
}
