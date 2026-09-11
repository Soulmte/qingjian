/**
 * Path arithmetic for workspace-relative links.
 *
 * Markdown resolves a relative link against the document that contains it, not
 * against the root of whatever folder happens to hold the project. Typora,
 * Obsidian, VS Code Preview and GitHub all read `![](assets/a.png)` in
 * `notes/a.md` as `notes/assets/a.png`. Resolving against the workspace root
 * instead would look correct inside 青简 and break the moment the file is opened
 * anywhere else — which is exactly what happened before these helpers existed.
 *
 * Everything here works on forward-slash, workspace-relative strings; the
 * conversion to an absolute path happens once, at the point of use.
 */

/** The folder part of a workspace-relative path, or `""` when it is at the root. */
export function dirOf(relPath: string): string {
  const index = relPath.lastIndexOf("/");
  return index <= 0 ? "" : relPath.slice(0, index);
}

/** Resolves a document-relative link into a workspace-relative path. */
export function resolveRelative(target: string, dir: string): string {
  const parts = dir ? dir.split("/").filter(Boolean) : [];

  for (const segment of target.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }

  return parts.join("/");
}

/**
 * Rewrites a workspace-relative path so it points there from `fromRelPath`.
 *
 * This is the inverse of [`resolveRelative`], and it is what keeps a stored
 * reference portable: an image always lives in the configured asset folder, but
 * the text written into the document is the shortest route to it from wherever
 * that document happens to sit.
 */
export function relativeTo(fromRelPath: string, target: string): string {
  const fromParts = dirOf(fromRelPath).split("/").filter(Boolean);
  const targetParts = target.split("/").filter(Boolean);

  let common = 0;
  while (
    common < fromParts.length &&
    common < targetParts.length &&
    fromParts[common] === targetParts[common]
  ) {
    common += 1;
  }

  const up = fromParts.slice(common).map(() => "..");
  return [...up, ...targetParts.slice(common)].join("/");
}
