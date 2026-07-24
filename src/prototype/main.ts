import { mount } from "svelte";
import PrototypeApp from "./PrototypeApp.svelte";
import "./styles.css";

const target = document.querySelector<HTMLElement>("#prototype-app");
if (target === null) throw new Error("Prototype mount point is missing");

mount(PrototypeApp, { target });
