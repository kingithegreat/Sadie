// Ambient module declarations for static asset imports.
// This file must NOT have any imports or exports — it needs to be a pure
// declaration file so TypeScript picks up the *.png etc. patterns globally.
declare module '*.png' { const url: string; export default url; }
declare module '*.jpg' { const url: string; export default url; }
declare module '*.jpeg' { const url: string; export default url; }
declare module '*.svg' { const url: string; export default url; }
declare module '*.webp' { const url: string; export default url; }
