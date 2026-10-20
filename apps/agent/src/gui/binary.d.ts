// Images included as bytes: esbuild `--loader:.png=binary --loader:.ico=binary`, the `binary` plugin in vitest.config.ts.
declare module '*.png' {
  const bytes: Uint8Array;
  export default bytes;
}
declare module '*.ico' {
  const bytes: Uint8Array;
  export default bytes;
}
