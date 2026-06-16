// smoke.mjs - Node driver for Patterson's denigma WASM (.musx -> MNX JSON).
//
// The malloc / HEAPU8 / call / read / free sequence is taken verbatim from the
// proof's main.js (Patterson's own example), so the memory handling is faithful.
// The only changes are for a headless context: read the .musx from disk and
// write the MNX JSON to disk, instead of reading a browser file input and
// painting the DOM.
//
// Usage:  node smoke.mjs <input.musx> <output.mnx>
// Run from the directory that holds denigma_wasm_mnx.js and denigma_wasm_mnx.wasm,
// so the glue resolves its .wasm beside itself.

import { readFileSync, writeFileSync } from 'node:fs';
import createModule from './denigma_wasm_mnx.js';

const POINTER_SIZE = 4;
const SIZE_T_TYPE = 'i32';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('Usage: node smoke.mjs <input.musx> <output.mnx>');
  process.exit(2);
}

const Module = await createModule({
  print: (t) => console.log(t),
  printErr: (t) => console.error(t),
});

const readPointer = (ptr) => Module.getValue(ptr, '*');
const readSize = (ptr) => Module.getValue(ptr, SIZE_T_TYPE);

function convert(bytes) {
  const inputPtr = Module._denigma_malloc(bytes.byteLength);
  Module.HEAPU8.set(bytes, inputPtr);

  const outputPtrPtr = Module._denigma_malloc(POINTER_SIZE);
  const outputSizePtr = Module._denigma_malloc(POINTER_SIZE);
  const errorPtrPtr = Module._denigma_malloc(POINTER_SIZE);
  Module.setValue(outputPtrPtr, 0, '*');
  Module.setValue(outputSizePtr, 0, SIZE_T_TYPE);
  Module.setValue(errorPtrPtr, 0, '*');

  try {
    const rc = Module._denigma_musx_to_mnx_json(
      inputPtr, bytes.byteLength, outputPtrPtr, outputSizePtr, errorPtrPtr
    );
    if (rc !== 0) {
      const errorPtr = readPointer(errorPtrPtr);
      const message = errorPtr ? Module.UTF8ToString(errorPtr) : 'conversion failed';
      if (errorPtr) Module._denigma_free(errorPtr);
      throw new Error(message);
    }
    const outputPtr = readPointer(outputPtrPtr);
    const outputSize = readSize(outputSizePtr);
    const json = new TextDecoder().decode(
      Module.HEAPU8.subarray(outputPtr, outputPtr + outputSize)
    );
    Module._denigma_free(outputPtr);
    return json;
  } finally {
    Module._denigma_free(inputPtr);
    Module._denigma_free(outputPtrPtr);
    Module._denigma_free(outputSizePtr);
    Module._denigma_free(errorPtrPtr);
  }
}

try {
  const bytes = new Uint8Array(readFileSync(inPath));
  const json = convert(bytes);
  JSON.parse(json); // prove the output is valid MNX JSON before writing
  writeFileSync(outPath, json);
  console.log(`OK: ${inPath} (${bytes.byteLength} bytes) -> ${outPath} (${json.length} chars)`);
} catch (err) {
  console.error(`FAILED on ${inPath}: ${err?.message || err}`);
  process.exit(1);
}
