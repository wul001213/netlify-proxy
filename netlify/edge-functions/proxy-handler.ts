// netlify/edge-functions/proxy-handler.ts
import type { Context } from "@netlify/edge-functions";

// 定义你的代理规则：路径前缀 => 目标基础 URL
const PROXY_CONFIG = {
  // API 服务器
  "/discord": "https://discord.com/api",
  "/telegram": "https://api.telegram.org",
  "/openai": "https://api.openai.com",
  "/claude": "https://api.anthropic.com",
  "/gemini": "https://generativelanguage.googleapis.com",
  "/meta": "https://www.meta.ai/api",
  "/groq": "https://api.groq.com/openai",
  "/xai": "https://api.x.ai",
  "/cohere": "https://api.cohere.ai",
  "/huggingface": "https://api-inference.huggingface.co",
  "/together": "https://api.together.xyz",
  "/novita": "https://api.novita.ai",
  "/portkey": "https://api.portkey.ai",
  "/fireworks": "https://api.fireworks.ai",
  "/openrouter": "https://openrouter.ai/api",
  // 任意网址
  "/hexo": "https://hexo-gally.vercel.app",
  "/hexo2": "https://hexo-987.pages.dev",
  "/halo": "https://blog.gally.dpdns.org",
  "/kuma": "https://kuma.gally.dpdns.org",
  "/hf": "https://huggingface.co",
  "/tv": "https://tv.gally.ddns-ip.net",
  "/news": "https://newsnow-ahm.pages.dev"
};

// 需要修复路径的内容类型
const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'application/xml', 'text/xml'];
const CSS_CONTENT_TYPES = ['text/css'];
const JS_CONTENT_TYPES = ['application/javascript', 'text/javascript', 'application/x-javascript'];

// 不需要修改内容的二进制文件扩展名
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp',
  'mp3', 'mp4', 'webm', 'ogg', 'wav', 'avi', 'mov',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'zip', 'rar', '7z', 'tar', 'gz',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
]);

// 统一的路径重写函数
function rewritePaths(content: string, targetDomain: string, proxyPrefix: string, origin: string, currentPath: string, contentType: string): string {
  const targetPathBase = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
  const proxyBaseUrl = `${origin}${proxyPrefix}`;

  // 根据内容类型使用不同的重写策略
  if (HTML_CONTENT_TYPES.some(t => contentType.includes(t))) {
    return rewriteHtmlPaths(content, targetDomain, proxyBaseUrl, targetPathBase);
  } else if (CSS_CONTENT_TYPES.some(t => contentType.includes(t))) {
    return rewriteCssPaths(content, targetDomain, proxyBaseUrl, targetPathBase);
  } else if (JS_CONTENT_TYPES.some(t => contentType.includes(t))) {
    return rewriteJsPaths(content, targetDomain, proxyBaseUrl);
  }
  return content;
}

// HTML 路径重写
function rewriteHtmlPaths(content: string, targetDomain: string, proxyBaseUrl: string, targetPathBase: string): string {
  // 统一处理所有属性中的路径引用
  const attrPattern = new RegExp(
    `(href|src|action|content|data-src|data-href|poster|background)=["']((?:https?:)?//${targetDomain.replace(/\./g, '\\.')}([^"']*)?)["']`,
    'gi'
  );
  content = content.replace(attrPattern, (match, attr, url, path) => {
    if (url.startsWith('//')) {
      return `${attr}="${proxyBaseUrl}${path}"`;
    }
    return `${attr}="${proxyBaseUrl}${path}"`;
  });

  // 处理根路径引用
  content = content.replace(
    /(href|src|action|content|data-src|data-href)=["']\/([^"']*)["']/gi,
    `$1="${proxyBaseUrl}/$2"`
  );

  // 处理相对路径
  content = content.replace(
    /(href|src|action|content|data-src|data-href)=["']((?![a-z]+:|\/\/|\/)([^"']*))["']/gi,
    `$1="${proxyBaseUrl}${targetPathBase}$2"`
  );

  // 处理 CSS 中的 url()
  content = content.replace(
    /url\(['"]?(?:(?:https?:)?\/\/)?[^'")]*\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot)['"]?\)/gi,
    (match) => {
      const urlMatch = match.match(/url\(['"]?([^'")]+)['"]?\)/i);
      if (urlMatch && urlMatch[1]) {
        const url = urlMatch[1];
        if (url.startsWith('//') || url.includes(targetDomain)) {
          const cleanUrl = url.replace(/^(?:https?:)?\/\/[^\/]+/, '');
          return `url("${proxyBaseUrl}${cleanUrl}")`;
        } else if (url.startsWith('/')) {
          return `url("${proxyBaseUrl}${url}")`;
        }
      }
      return match;
    }
  );

  // 处理 srcset
  content = content.replace(
    /srcset=["']([^"']+)["']/gi,
    (match, srcset) => {
      return `srcset="${srcset.split(',').map(item => {
        const [src, ...desc] = item.trim().split(/\s+/);
        if (src.startsWith('/') && !src.startsWith('//')) {
          return `${proxyBaseUrl}${src}${desc.length ? ' ' + desc.join(' ') : ''}`;
        }
        return item;
      }).join(', ')}"`;
    }
  );

  // 处理 <base> 标签
  content = content.replace(
    /<base[^>]*href=["'][^"']*["'][^>]*>/gi,
    `<base href="${proxyBaseUrl}/">`
  );

  return content;
}

// CSS 路径重写
function rewriteCssPaths(content: string, targetDomain: string, proxyBaseUrl: string, targetPathBase: string): string {
  // 处理 url() 中的各种路径
  return content.replace(
    /url\(['"]?([^'")]+)['"]?\)/gi,
    (match, url) => {
      // 跳过 data: URL 和 #
      if (url.startsWith('data:') || url.startsWith('#')) {
        return match;
      }

      // 处理绝对 URL
      if (url.includes(targetDomain) || url.startsWith('//')) {
        const cleanUrl = url.replace(/^(?:https?:)?\/\/[^\/]+/, '');
        return `url("${proxyBaseUrl}${cleanUrl}")`;
      }

      // 处理根路径
      if (url.startsWith('/')) {
        return `url("${proxyBaseUrl}${url}")`;
      }

      // 处理相对路径
      return `url("${proxyBaseUrl}${targetPathBase}${url}")`;
    }
  );
}

// JavaScript 路径重写
function rewriteJsPaths(content: string, targetDomain: string, proxyBaseUrl: string): string {
  // 替换字符串中的绝对 URL
  content = content.replace(
    new RegExp(`(['"])https?://${targetDomain.replace(/\./g, '\\.')}([^'"]*?)\\1`, 'gi'),
    `$1${proxyBaseUrl}$2$1`
  );

  // 替换协议相对 URL
  content = content.replace(
    new RegExp(`(['"])//${targetDomain.replace(/\./g, '\\.')}([^'"]*?)\\1`, 'gi'),
    `$1${proxyBaseUrl}$2$1`
  );

  return content;
}

// 生成动态修复脚本
function generateFixScript(proxyPrefix: string, origin: string): string {
  const proxyBaseUrl = `${origin}${proxyPrefix}`;
  return `
<script>
(function() {
  // 获取当前代理前缀
  const PROXY_PREFIX = '${proxyPrefix}';
  const PROXY_BASE_URL = '${proxyBaseUrl}';

  // 修复 URL 的工具函数
  function fixUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('#')) {
      return url;
    }
    if (url.startsWith('/')) {
      return PROXY_BASE_URL + url;
    }
    return url;
  }

  // 拦截 fetch 请求
  const originalFetch = window.fetch;
  window.fetch = function(resource, init) {
    if (typeof resource === 'string' && resource.startsWith('/')) {
      resource = PROXY_BASE_URL + resource;
    }
    return originalFetch.call(this, resource, init);
  };

  // 拦截 XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string' && url.startsWith('/')) {
      url = PROXY_BASE_URL + url;
    }
    return originalOpen.call(this, method, url);
  };

  // 监听 DOM 变化，修复动态添加的元素
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) {
          // 修复标签属性
          const attrs = ['src', 'href', 'action', 'data-src', 'data-href', 'poster', 'background'];
          attrs.forEach(function(attr) {
            if (node.hasAttribute && node.hasAttribute(attr)) {
              const value = node.getAttribute(attr);
              if (value && value.startsWith('/')) {
                node.setAttribute(attr, PROXY_BASE_URL + value);
              }
            }
          });

          // 修复子元素
          const elements = node.querySelectorAll ? node.querySelectorAll('[' + attrs.join('],[') + ']') : [];
          elements.forEach(function(el) {
            attrs.forEach(function(attr) {
              if (el.hasAttribute(attr)) {
                const value = el.getAttribute(attr);
                if (value && value.startsWith('/')) {
                  el.setAttribute(attr, PROXY_BASE_URL + value);
                }
              }
            });
          });

          // 修复内联样式
          if (node.style && node.style.cssText) {
            const style = node.style.cssText;
            const newStyle = style.replace(/url\\(['"]?\\/[^)'"]*?['"]?\\)/gi, function(match) {
              return match.replace(/url\\(['"]?\\//, 'url("' + PROXY_BASE_URL + '/');
            });
            if (style !== newStyle) {
              node.style.cssText = newStyle;
            }
          }
        }
      });
    });
  });

  // 开始监听
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    });
  } else {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  // 修复页面加载时的元素
  document.querySelectorAll('script[src], link[href], img[src], a[href], iframe[src], video[src], audio[src]').forEach(function(el) {
    ['src', 'href'].forEach(function(attr) {
      if (el.hasAttribute(attr)) {
        const value = el.getAttribute(attr);
        if (value && value.startsWith('/')) {
          el.setAttribute(attr, PROXY_BASE_URL + value);
        }
      }
    });
  });
})();
</script>`;
}

export default async (request: Request, context: Context) => {
  // 处理 CORS 预检请求
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin, Range, Upgrade",
        "Access-Control-Expose-Headers": "Content-Length, Content-Type, Content-Disposition",
        "Access-Control-Max-Age": "86400"
      }
    });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // 处理 /proxy/ 路径 - 代理任意 URL
  if (path.startsWith('/proxy/')) {
    return handleGenericProxy(request, context, url, path);
  }

  // 查找匹配的代理配置
  const { targetBaseUrl, matchedPrefix } = findProxyConfig(path);

  if (!targetBaseUrl || !matchedPrefix) {
    return; // 没有匹配的规则，交由 Netlify 处理
  }

  // 构造目标 URL
  const remainingPath = path.substring(matchedPrefix.length);
  const targetUrlString = targetBaseUrl.replace(/\/$/, '') + remainingPath;
  const targetUrl = new URL(targetUrlString);
  targetUrl.search = url.search;

  context.log(`Proxying "${path}" to "${targetUrl.toString()}"`);

  try {
    const proxyRequest = buildProxyRequest(request, targetUrl, url, context);
    const response = await fetch(proxyRequest);

    return buildProxyResponse(response, targetUrl, matchedPrefix, url, context);
  } catch (error) {
    context.log("Error fetching target URL:", error);
    return new Response("代理请求失败", {
      status: 502,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain;charset=UTF-8'
      }
    });
  }
};

// 查找匹配的代理配置
function findProxyConfig(path: string): { targetBaseUrl: string | null; matchedPrefix: string | null } {
  const prefixes = Object.keys(PROXY_CONFIG).sort().reverse();

  for (const prefix of prefixes) {
    if (path === prefix || path.startsWith(prefix + '/')) {
      return {
        targetBaseUrl: PROXY_CONFIG[prefix as keyof typeof PROXY_CONFIG],
        matchedPrefix: prefix
      };
    }
  }

  return { targetBaseUrl: null, matchedPrefix: null };
}

// 处理通用代理
async function handleGenericProxy(request: Request, context: Context, url: URL, path: string): Promise<Response> {
  try {
    let targetUrlString = path.substring('/proxy/'.length);

    if (targetUrlString.startsWith('http%3A%2F%2F') || targetUrlString.startsWith('https%3A%2F%2F')) {
      targetUrlString = decodeURIComponent(targetUrlString);
    }

    if (!targetUrlString.startsWith('http://') && !targetUrlString.startsWith('https://')) {
      targetUrlString = 'https://' + targetUrlString;
    }

    const targetUrl = new URL(targetUrlString);

    if (url.search && !targetUrlString.includes('?')) {
      targetUrl.search = url.search;
    }

    context.log(`Proxying generic request to: ${targetUrl.toString()}`);

    const proxyRequest = buildProxyRequest(request, targetUrl, url, context);
    const response = await fetch(proxyRequest);

    const newResponse = buildProxyResponse(response, targetUrl, '/proxy/', url, context);

    // 处理重定向
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      const location = response.headers.get('location')!;
      const redirectedUrl = new URL(location, targetUrl);
      const newLocation = `${url.origin}/proxy/${encodeURIComponent(redirectedUrl.toString())}`;
      newResponse.headers.set('Location', newLocation);
    }

    return newResponse;
  } catch (error) {
    context.log(`Error proxying generic URL: ${error}`);
    return new Response(`代理请求失败: ${error}`, {
      status: 502,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain;charset=UTF-8'
      }
    });
  }
}

// 构建代理请求
function buildProxyRequest(request: Request, targetUrl: URL, proxyUrl: URL, context: Context): Request {
  const proxyRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: new Headers(request.headers),
    body: request.body,
    redirect: 'manual'
  });

  // 设置必要的请求头
  proxyRequest.headers.set("Host", targetUrl.host);

  const clientIp = context.ip || request.headers.get('x-nf-client-connection-ip') || "";
  proxyRequest.headers.set('X-Forwarded-For', clientIp);
  proxyRequest.headers.set('X-Forwarded-Host', proxyUrl.host);
  proxyRequest.headers.set('X-Forwarded-Proto', proxyUrl.protocol.replace(':', ''));

  // 处理 Referer
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const newReferer = `${targetUrl.protocol}//${targetUrl.host}${refUrl.pathname}${refUrl.search}`;
      proxyRequest.headers.set('referer', newReferer);
    } catch (e) {
      // 忽略解析错误
    }
  } else {
    proxyRequest.headers.set('referer', `${targetUrl.protocol}//${targetUrl.host}/`);
  }

  // 处理 Origin（对于跨域请求很重要）
  const origin = request.headers.get('origin');
  if (origin) {
    proxyRequest.headers.set('origin', `${targetUrl.protocol}//${targetUrl.host}`);
  }

  // 移除可能导致问题的头部
  proxyRequest.headers.delete('accept-encoding');
  proxyRequest.headers.delete('cookie'); // 避免传递 cookie

  return proxyRequest;
}

// 构建代理响应
async function buildProxyResponse(
  response: Response,
  targetUrl: URL,
  matchedPrefix: string,
  proxyUrl: URL,
  context: Context
): Promise<Response> {
  const contentType = response.headers.get('content-type') || '';
  const proxyBaseUrl = `${proxyUrl.origin}${matchedPrefix}`;

  // 检查是否需要重写内容
  const needsRewrite = shouldRewriteContent(contentType, targetUrl.pathname);

  let newResponse: Response;

  if (needsRewrite) {
    // 克隆响应以读取内容
    const clonedResponse = response.clone();
    let content = await clonedResponse.text();

    // 重写路径
    content = rewritePaths(content, targetUrl.host, matchedPrefix, proxyUrl.origin, targetUrl.pathname, contentType);

    // 对于 HTML，添加修复脚本
    if (HTML_CONTENT_TYPES.some(t => contentType.includes(t))) {
      const fixScript = generateFixScript(matchedPrefix, proxyUrl.origin);
      const bodyClosePos = content.lastIndexOf('</body>');
      if (bodyClosePos !== -1) {
        content = content.substring(0, bodyClosePos) + fixScript + content.substring(bodyClosePos);
      } else {
        content += fixScript;
      }
    }

    // 创建新响应
    newResponse = new Response(content, {
      status: response.status,
      statusText: response.statusText
    });
  } else {
    // 对于二进制内容，直接传递
    newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText
    });
  }

  // 复制并修改响应头
  copyHeaders(response.headers, newResponse.headers, proxyBaseUrl, targetUrl, matchedPrefix, proxyUrl, contentType);

  // 处理重定向
  if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
    handleRedirect(response, newResponse, targetUrl, matchedPrefix, proxyUrl, context);
  }

  return newResponse;
}

// 判断是否需要重写内容
function shouldRewriteContent(contentType: string, pathname: string): boolean {
  // 检查内容类型
  if (HTML_CONTENT_TYPES.some(t => contentType.includes(t))) {
    return true;
  }
  if (CSS_CONTENT_TYPES.some(t => contentType.includes(t))) {
    return true;
  }
  if (JS_CONTENT_TYPES.some(t => contentType.includes(t))) {
    return true;
  }

  // 检查文件扩展名
  const ext = pathname.split('.').pop()?.toLowerCase();
  if (ext && BINARY_EXTENSIONS.has(ext)) {
    return false;
  }

  // 检查是否是文本类型
  if (contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml')) {
    return true;
  }

  return false;
}

// 复制并修改响应头
function copyHeaders(
  sourceHeaders: Headers,
  targetHeaders: Headers,
  proxyBaseUrl: string,
  targetUrl: URL,
  matchedPrefix: string,
  proxyUrl: URL,
  contentType: string
): void {
  // 复制所有头部
  sourceHeaders.forEach((value, key) => {
    // 跳过一些需要特殊处理的头部
    if (['content-length', 'content-encoding', 'transfer-encoding', 'set-cookie'].includes(key.toLowerCase())) {
      return;
    }
    targetHeaders.set(key, value);
  });

  // 添加 CORS 头
  targetHeaders.set('Access-Control-Allow-Origin', '*');
  targetHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  targetHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Range');
  targetHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Content-Disposition');

  // 移除安全头部
  targetHeaders.delete('Content-Security-Policy');
  targetHeaders.delete('Content-Security-Policy-Report-Only');
  targetHeaders.delete('X-Frame-Options');
  targetHeaders.delete('X-Content-Type-Options');

  // 设置缓存策略
  if (HTML_CONTENT_TYPES.some(t => contentType.includes(t))) {
    targetHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    targetHeaders.set('Pragma', 'no-cache');
    targetHeaders.set('Expires', '0');
  } else {
    targetHeaders.set('Cache-Control', 'public, max-age=86400');
  }
}

// 处理重定向
function handleRedirect(
  response: Response,
  newResponse: Response,
  targetUrl: URL,
  matchedPrefix: string,
  proxyUrl: URL,
  context: Context
): void {
  const location = response.headers.get('location')!;
  const redirectedUrl = new URL(location, targetUrl);

  if (redirectedUrl.origin === targetUrl.origin) {
    // 重定向到同一域，需要重写
    const newLocation = proxyUrl.origin + matchedPrefix + redirectedUrl.pathname + redirectedUrl.search;
    context.log(`Rewriting redirect from ${location} to ${newLocation}`);
    newResponse.headers.set('Location', newLocation);
  } else {
    // 重定向到外部域
    context.log(`Proxying redirect to external location: ${location}`);
  }
} 