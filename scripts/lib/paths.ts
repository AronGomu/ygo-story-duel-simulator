import path from "node:path";

export function resolveProjectSubpath(
  projectRoot: string,
  requestedPath: string,
  allowedRelativeRoot: string,
  label: string,
): string {
  if (path.isAbsolute(requestedPath)) {
    throw new Error(`${label} must be relative to the project root`);
  }

  const allowedRoot = path.resolve(projectRoot, allowedRelativeRoot);
  const resolved = path.resolve(projectRoot, requestedPath);
  const relative = path.relative(allowedRoot, resolved);

  if (relative === "") {
    throw new Error(`${label} must be a child of ${allowedRelativeRoot}, not the root itself`);
  }
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return resolved;
  }

  throw new Error(`${label} must stay under ${allowedRelativeRoot}`);
}
