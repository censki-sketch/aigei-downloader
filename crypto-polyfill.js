// crypto polyfill for Node.js < 18
const crypto = require('crypto')
const getRandomValues = crypto.webcrypto?.getRandomValues
  ? crypto.webcrypto.getRandomValues.bind(crypto.webcrypto)
  : function (arr) {
      const buf = crypto.randomBytes(arr.length)
      for (let i = 0; i < arr.length; i++) arr[i] = buf[i]
      return arr
    }

if (typeof crypto.getRandomValues !== 'function') {
  crypto.getRandomValues = getRandomValues
}

if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto = crypto.webcrypto || { getRandomValues }
}
