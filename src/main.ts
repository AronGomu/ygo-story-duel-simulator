import { mount } from "svelte";
import App from "./app/App.svelte";
import "./styles/app.css";

const target = document.querySelector<HTMLElement>("#app");
if (target === null) throw new Error("Application mount point is missing");

mount(App, { target });
