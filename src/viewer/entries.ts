/**
 * Auto-discovers viewer-asset registration modules.
 *
 * Every file in `src/viewer/entries/` is imported for its side effects (each calls
 * `registerAsset(...)` at module scope). Asset tasks add their own entry file and
 * never touch main.ts or any shared file — this is what makes parallel asset
 * development conflict-free.
 */
export function loadEntries(): void {
  import.meta.glob('./entries/*.ts', { eager: true });
}
