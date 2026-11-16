const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { createRequire } = require('node:module')
const ts = require('typescript')

module.exports = function loadMain(name, replacements) {
  const filename = resolve(__dirname, '../src/main', name + '.ts')
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText
  const realRequire = createRequire(filename)
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', code)(id =>
    Object.hasOwn(replacements, id) ? replacements[id] : realRequire(id), loaded, loaded.exports)
  return loaded.exports
}
