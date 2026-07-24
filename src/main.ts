import { mount } from "svelte";
import { selectAppEntry } from "./app/select-app-entry.ts";
import "./styles/app.css";

const target = document.querySelector<HTMLElement>("#app");
if (target === null) throw new Error("Application mount point is missing");

try {
  if (selectAppEntry(globalThis.location.hash) === "deck-builder-prototype") {
    const { default: DeckBuilderPrototype } =
      await import("./prototypes/deck-builder/DeckBuilderPrototype.svelte");
    mount(DeckBuilderPrototype, { target });
  } else {
    const { default: App } = await import("./app/App.svelte");
    mount(App, { target });
  }
} catch (error) {
  target.replaceChildren();
  const main = document.createElement("main");
  main.setAttribute("role", "alert");
  const heading = document.createElement("h1");
  heading.textContent = "Application could not start";
  const message = document.createElement("p");
  message.textContent =
    error instanceof Error
      ? error.message
      : "Required application code failed to load.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => globalThis.location.reload());
  main.append(heading, message, retry);
  target.append(main);
}
