/**
 * 爱给网下载加密模块
 *
 * 爱给网的下载流程涉及双层加密：
 * 1. 从资源页提取动态参数：cccllpptttgt、pIii111lllE、vvvvvvviisssss、token、extime
 * 2. 调用 aigei.js 中的 dfu() 生成加密请求体
 * 3. 调用 cqbj() 二次加密
 * 4. 调用 cupie() 生成请求头 x-requested-etag
 * 5. POST /f/d/{fileType} 获取加密响应
 * 6. 解密响应得到真实下载链接
 *
 * 注意：爱给网的加密函数会定期更新，以下实现基于公开逆向资料。
 * 如果失效，需要重新从 aigei.js 中扣取最新加密逻辑。
 * 参考：
 *   - https://www.52pojie.cn/thread-2047580-1-1.html
 *   - https://www.cnblogs.com/352387312-dada/p/19058088
 */

/**
 * 简化的 dfu 函数 - 生成加密请求参数
 * 实际实现需要从 aigei.js 扣取完整的加密逻辑
 */
export function dfu(
  ftype: string,
  itemId: string,
  extime: string,
  token: string,
  vvvvvvviisssss: string
): Record<string, any> {
  // 基础参数结构
  const base = {
    type: ftype,
    fileUuid: '',
    model: 'play',
    itemId: itemId,
    item: null,
    rescUrl: itemId,
    expireTime: extime,
    token: token,
    callBack: 'callBackAudioFilePlay',
    resJsCallback: 'downloadAudioCallback',
    custPlayCallBack: null,
    downUuid: null,
    ud: generateUd(itemId, vvvvvvviisssss),
    customData: {
      '0': { jQuery11020794731646544379: 4191 },
      context: { jQuery11020794731646544379: 4191 },
      length: 1
    }
  }
  return base
}

/**
 * 简化的 cqbj 函数 - 二次加密请求体
 */
export function cqbj(data: Record<string, any>): string {
  // 实际实现需要扣取 aigei.js 中的 cqbj 函数
  // 这里用 JSON 序列化作为占位，实际是复杂的加密序列化
  return encodeParams(data)
}

/**
 * 简化的 cupie 函数 - 生成 ETag 请求头
 */
export function cupie(input: string): string {
  // 实际实现需要扣取 aigei.js 中的 cupie 函数
  // 这是一个哈希函数，生成 x-requested-etag 头
  return simpleHash(input)
}

/**
 * 解密服务器响应，得到真实下载链接
 */
export function decryptResponse(encrypted: string): string {
  try {
    // 服务器返回 base64 编码的加密数据
    // 解密后包含真实下载链接
    const decoded = Buffer.from(encrypted, 'base64').toString('utf-8')
    // 尝试解析 JSON
    try {
      const json = JSON.parse(decoded)
      // 链接通常在 message 或 url 或 data 字段中
      return json.url || json.message || json.data?.url || json.data || ''
    } catch {
      // 可能是纯文本链接
      if (decoded.startsWith('http')) return decoded
      return decoded
    }
  } catch {
    return ''
  }
}

// ==================== 辅助函数 ====================

function generateUd(itemId: string, vis: string): string {
  // ud 是一个基于 itemId 和 vvvvvvviisssss 生成的标识
  return simpleHash(itemId + vis + Date.now())
}

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

function encodeParams(data: Record<string, any>): string {
  // 简化的参数编码，实际 cqbj 会做更复杂的处理
  const pairs: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue
    const v = typeof value === 'object' ? JSON.stringify(value) : String(value)
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`)
  }
  return pairs.join('&')
}

/**
 * 重要说明：
 *
 * 以上加密函数是简化版占位实现。要让下载真正工作，需要：
 *
 * 1. 用浏览器打开 https://www.aigei.com/sound/ 任意资源页
 * 2. F12 打开开发者工具，搜索 "dfu" 定位加密函数
 * 3. 把 dfu、cqbj、cupie 三个函数及它们的依赖完整扣取
 * 4. 替换本文件中的简化实现
 *
 * 详细扣取教程见：
 * - https://www.52pojie.cn/thread-2047580-1-1.html
 * - https://www.cnblogs.com/352387312-dada/p/19058088
 *
 * 或者，更可靠的方式是直接在 Playwright 页面里调用页面原有的
 * window.dfu / window.cqbj / window.cupie 函数（见 downloader.ts）。
 */
