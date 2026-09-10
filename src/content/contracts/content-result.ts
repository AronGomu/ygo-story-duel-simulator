import type { ContentFailure } from "./content-failure.ts";

export type ContentResult<T> =
  { readonly kind: "ok"; readonly value: T } | ContentFailure;
