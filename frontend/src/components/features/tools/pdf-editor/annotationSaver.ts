/** Serialize saves and include edits made while an upload is in flight. */
export function createAnnotationSaver<T>(
  getCurrent: () => T,
  save: (snapshot: T) => Promise<unknown>,
): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    if (pending) return pending;
    pending = (async () => {
      let snapshot: T;
      do {
        snapshot = getCurrent();
        await save(snapshot);
      } while (getCurrent() !== snapshot);
    })().finally(() => { pending = null; });
    return pending;
  };
}
