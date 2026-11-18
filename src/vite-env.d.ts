/// <reference types="vite/client" />

declare module 'virtual:forms-manifest' {
  const manifest: import('./types/forms').FormsManifest;
  export default manifest;
}
