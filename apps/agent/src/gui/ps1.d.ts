// Scripts PowerShell included as text: esbuild `--loader:.ps1=text`, the `ps1-text` plugin in vitest.config.ts.
declare module '*.ps1' {
  const text: string;
  export default text;
}
