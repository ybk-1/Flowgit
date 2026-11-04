# Third-party notices

The Flowgit extension itself is Apache-2.0, the same license as the Flowgit repository.

## jsonc-parser

- Copyright Microsoft Corporation
- License: MIT
- Bundled into `dist/extension.js`
- https://github.com/microsoft/node-jsonc-parser

## yaml

- Copyright Eemeli Aro
- License: ISC
- Bundled into `dist/extension.js`; the same YAML parser `@flowgit/core` uses for flow.md
- https://github.com/eemeli/yaml

## @types/vscode

- Copyright Microsoft Corporation
- License: MIT
- Used only while typechecking. Not included in the extension package.
- Pinned to 1.125.0: npm does not publish 1.128.0, and 1.134.0 is newer than the `engines.vscode` floor.
- https://github.com/DefinitelyTyped/DefinitelyTyped

## esbuild

- Copyright Evan Wallace
- License: MIT
- Used only to produce `dist/extension.js`. Not included in the extension package.
- Same version range as `packages/core` and `packages/app`: `^0.25.12`
- https://github.com/evanw/esbuild

## flow.schema.json

Copied at build time from `packages/core/schema/flow.schema.json`. That file is part of `@flowgit/core` and is Apache-2.0.
