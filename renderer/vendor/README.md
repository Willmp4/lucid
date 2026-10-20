# Vendored files

The renderer runs on `node` alone, with no `npm install`. These files are
committed as their packages published them.

| File | Source | Version | Licence |
|---|---|---|---|
| `rough.mjs` | `bundled/rough.esm.js` from the npm package [`roughjs`](https://www.npmjs.com/package/roughjs), with a licence header added | 4.6.6 | MIT, in the file's header |
| `resvg.mjs` | `index.mjs` from the npm package [`@resvg/resvg-wasm`](https://www.npmjs.com/package/@resvg/resvg-wasm), with a licence header added | 2.6.2 | MPL-2.0 |
| `resvg.wasm` | `index_bg.wasm` from the same package, renamed | 2.6.2 | MPL-2.0 |
| `JetBrainsMono-Regular.ttf` | `400Regular/JetBrainsMono_400Regular.ttf` from the npm package [`@expo-google-fonts/jetbrains-mono`](https://www.npmjs.com/package/@expo-google-fonts/jetbrains-mono) 0.4.1, the Google Fonts build of [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | 2.211 | OFL-1.1, in `OFL.txt` |
| `OFL.txt` | `LICENSE_FONT` from the same package | | |

`rough.mjs` bundles roughjs's own dependencies (points-on-curve,
points-on-path, path-data-parser, and hachure-fill), by the same author under
the same licence. The source of `resvg.mjs` and `resvg.wasm` is
[yisibl/resvg-js](https://github.com/yisibl/resvg-js); the MPL-2.0 text is at
<https://mozilla.org/MPL/2.0/>.

resvg as WebAssembly reads no system fonts, so the PNG's text takes the
vendored font. A file that fails to load costs only the PNG: the renderer
still writes the SVG and the version in terminal cells.

SHA-256 of each file as the package published it:

```text
e921535f216ebc93d422489d614da955b5286812220b3149fc70978f4cb5bd45  roughjs 4.6.6 bundled/rough.esm.js
10170d02d816f02ec76f9bc095b01d9becf536e7b1e12e5aa616652c84b237a1  @resvg/resvg-wasm 2.6.2 index.mjs
22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70  @resvg/resvg-wasm 2.6.2 index_bg.wasm
b6b1ff4ddefe36d7f2a6174e1d001cab374e594519ee9049af028d577b64c5f5  @expo-google-fonts/jetbrains-mono 0.4.1 400Regular/JetBrainsMono_400Regular.ttf
```

To update one, run `npm pack <package>@<version>` in an empty folder, copy
the file in under the name above, keep the header on a `.mjs` file, and
update this page.

`../mkflow.mjs`, the layout generator, is plain JavaScript with no imports
and no package.
