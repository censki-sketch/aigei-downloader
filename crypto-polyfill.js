// crypto polyfill for Node.js < 18
const crypto = require('crypto')
if (!globalThis.crypto) {
  if (crypto.webcrypto) {
    globalThis.crypto = crypto.webcrypto
  } else {
    // Node.js 14/15 fallback
    globalThis.crypto = {
      getRandomValues: function (arr) {
        const buf = crypto.randomBytes(arr.length)
        for (let i = 0; i < arr.length; i++) arr[i] = buf[i]
        return arr
      }
    }
  }
}
