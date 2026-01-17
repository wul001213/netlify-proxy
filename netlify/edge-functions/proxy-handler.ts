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
  // 网站代理
  "/x": "https://x.com",
  "/twitter": "https://twitter.com",
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
  
  // 定义应该重写的 HTML 标签和属性
  const URL_ATTRIBUTES = {
    // link 标签
    'link': ['href'],
    // script 标签
    'script': ['src'],
    // img 标签
    'img': ['src', 'srcset'],
    // video 标签
    'video': ['src', 'poster'],
    // audio 标签
    'audio': ['src'],
    // source 标签
    'source': ['src', 'srcset'],
    // iframe 标签
    'iframe': ['src'],
    // a 标签
    'a': ['href'],
    // area 标签
    'area': ['href'],
    // base 标签
    'base': ['href'],
    // form 标签
    'form': ['action'],
    // input 标签
    'input': ['src', 'formaction'],
    // button 标签
    'button': ['formaction'],
    // object 标签
    'object': ['data'],
    // embed 标签
    'embed': ['src'],
    // track 标签
    'track': ['src'],
    // blockquote 标签
    'blockquote': ['cite'],
    // q 标签
    'q': ['cite'],
    // ins 标签
    'ins': ['cite'],
    // del 标签
    'del': ['cite'],
  };

  // 1. 处理 <link> 标签的 href 属性（包括 preconnect、dns-prefetch）
  content = content.replace(
    /<link\s+([^>]*?)\s*(?:href|data-href)=["']((?:https?:)?\/\/)?([^"']*?)["']([^>]*?)>/gi,
    (match, before, protocol, url, after) => {
      // 检查是否是外部域名（如 abs.twimg.com）
      if (url && (url.includes('.') || url.includes(':'))) {
        // 如果是外部域名，不重写
        return match;
      }
      // 如果是根路径，添加代理前缀
      if (url && url.startsWith('/')) {
        return `<link ${before} href="${proxyBaseUrl}${url}"${after}>`;
      }
      return match;
    }
  );

  // 2. 处理包含目标域名的绝对 URL（排除 meta 标签）
  content = content.replace(
    new RegExp(
      `<(?!meta)([^>]*?)\\s*(href|src|action|data-href|data-src|poster|cite|formaction|manifest)=["']((?:https?:)?//${targetDomain.replace(/\./g, '\\.')})([^"']*?)["']`,
      'gi'
    ),
    (match, tag, attr, protocol, path) => {
      return `${attr}="${proxyBaseUrl}${path}"`;
    }
  );

  // 3. 处理根路径引用（只对特定标签的属性，排除 meta 标签）
  const rootPathPattern = /<(?!meta)(a|link|script|img|video|audio|source|iframe|area|form|input|button|object|embed|track|blockquote|q|ins|del)\s+([^>]*?)\s*(href|src|action|data-href|data-src|poster|cite|formaction|manifest)=["']\/([^"']*)["']([^>]*?)>/gi;
  content = content.replace(rootPathPattern, (match, tag, before, attr, path, after) => {
    return `<${tag} ${before}${attr}="${proxyBaseUrl}/${path}"${after}>`;
  });

  // 4. 处理相对路径（只对特定标签的属性，排除 meta 标签）
  const relativePathPattern = /<(?!meta)(a|link|script|img|video|audio|source|iframe|area|form|input|button|object|embed|track|blockquote|q|ins|del)\s+([^>]*?)\s*(href|src|action|data-href|data-src|poster|cite|formaction|manifest)=["']((?![a-z]+:|\/\/|\/)([^"']*?\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|json|xml|html|htm|mp4|webm|mp3|ogg|wav))["']([^>]*?)>/gi;
  content = content.replace(relativePathPattern, (match, tag, before, attr, path, after) => {
    return `<${tag} ${before}${attr}="${proxyBaseUrl}${targetPathBase}${path}"${after}>`;
  });

  // 5. 处理 srcset 属性
  content = content.replace(
    /srcset=["']([^"']+)["']/gi,
    (match, srcset) => {
      return `srcset="${srcset.split(',').map(item => {
        const parts = item.trim().split(/\s+/);
        const src = parts[0];
        const descriptor = parts.slice(1).join(' ');
        
        if (src.startsWith('/') && !src.startsWith('//')) {
          return `${proxyBaseUrl}${src}${descriptor ? ' ' + descriptor : ''}`;
        }
        return item;
      }).join(', ')}"`;
    }
  );

  // 6. 处理 <base> 标签
  content = content.replace(
    /<base\s+[^>]*href=["'][^"']*["'][^>]*>/gi,
    (match) => {
      return match.replace(/href=["'][^"']*["']/gi, `href="${proxyBaseUrl}/"`);
    }
  );

  // 7. 处理 style 标签和 style 属性中的 url()
  content = content.replace(
    /url\(['"]?([^'")]+)['"]?\)/gi,
    (match, url) => {
      // 跳过 data: URL 和 #
      if (url.startsWith('data:') || url.startsWith('#')) {
        return match;
      }

      // 处理包含目标域名的 URL
      if (url.includes(targetDomain)) {
        const cleanUrl = url.replace(/^(?:https?:)?\/\/[^\/]+/, '');
        return `url("${proxyBaseUrl}${cleanUrl}")`;
      }

      // 处理协议相对 URL
      if (url.startsWith('//')) {
        const cleanUrl = url.replace(/^\/\/[^\/]+/, '');
        return `url("${proxyBaseUrl}${cleanUrl}")`;
      }

      // 处理根路径
      if (url.startsWith('/')) {
        return `url("${proxyBaseUrl}${url}")`;
      }

      // 相对路径保持不变
      return match;
    }
  );

  // 8. 处理内联 JavaScript 中的字符串路径（只在 script 标签内）
  content = content.replace(
    /<script[^>]*>([\s\S]*?)<\/script>/gi,
    (match, scriptContent) => {
      const newScriptContent = scriptContent.replace(
        /(['"])(\/[^'"]*?\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|json|xml|html|htm))(['"])/gi,
        `$1${proxyBaseUrl}$2$3`
      );
      return `<script>${newScriptContent}</script>`;
    }
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

  // 替换根路径 URL (处理 / 开头的路径)
  content = content.replace(
    /(['"])(\/[^'"]*?\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|json|xml|html|htm))(['"])/gi,
    `$1${proxyBaseUrl}$2$3`
  );

  // 替换 API 路径 (处理 /api/ 开头的路径)
  content = content.replace(
    /(['"])(\/api\/[^'"]*?)(['"])/gi,
    `$1${proxyBaseUrl}$2$3`
  );

  return content;
}

// 生成动态修复脚本
function generateFixScript(proxyPrefix: string, origin: string): string {
  const proxyBaseUrl = `${origin}${proxyPrefix}`;
  return `
<script>
(function() {
  'use strict';
  
  // 获取当前代理前缀
  const PROXY_PREFIX = '${proxyPrefix}';
  const PROXY_BASE_URL = '${proxyBaseUrl}';

  // 修复 URL 的工具函数
  function fixUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('#') || url.startsWith('blob:')) {
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
    } else if (resource instanceof Request && resource.url && resource.url.startsWith('/')) {
      const newResource = new Request(PROXY_BASE_URL + resource.url, resource);
      return originalFetch.call(this, newResource, init);
    }
    return originalFetch.call(this, resource, init);
  };

  // 拦截 XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (typeof url === 'string' && url.startsWith('/')) {
      url = PROXY_BASE_URL + url;
    }
    return originalOpen.call(this, method, url, ...args);
  };

  // 拦截 WebSocket（如果需要）
  if (window.WebSocket) {
    const originalWebSocket = window.WebSocket;
    window.WebSocket = function(url, ...args) {
      if (typeof url === 'string' && url.startsWith('/')) {
        // 将 ws:// 或 wss:// 转换为代理 URL
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        url = protocol + '//' + window.location.host + PROXY_BASE_URL + url;
      }
      return new originalWebSocket(url, ...args);
    };
  }

  // 修复元素的属性
  function fixElementAttributes(el) {
    const attrs = ['src', 'href', 'action', 'data-src', 'data-href', 'poster', 'background', 'cite', 'formaction', 'ping', 'manifest'];
    attrs.forEach(function(attr) {
      if (el.hasAttribute && el.hasAttribute(attr)) {
        const value = el.getAttribute(attr);
        if (value && value.startsWith('/')) {
          el.setAttribute(attr, PROXY_BASE_URL + value);
        }
      }
    });
  }

  // 修复内联样式
  function fixInlineStyle(el) {
    if (!el.style || !el.style.cssText) return;
    const style = el.style.cssText;
    const newStyle = style.replace(/url\(['"]?\/[^)'"]*?['"]?\)/gi, function(match) {
      const urlMatch = match.match(/url\(['"]?([^'")]+)['"]?\)/i);
      if (urlMatch && urlMatch[1] && urlMatch[1].startsWith('/')) {
        return 'url("' + PROXY_BASE_URL + urlMatch[1] + '")';
      }
      return match;
    });
    if (style !== newStyle) {
      el.style.cssText = newStyle;
    }
  }

  // 监听 DOM 变化，修复动态添加的元素
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) { // 元素节点
          // 修复当前节点
          fixElementAttributes(node);
          fixInlineStyle(node);

          // 修复子元素
          if (node.querySelectorAll) {
            const elements = node.querySelectorAll('*');
            elements.forEach(function(el) {
              fixElementAttributes(el);
              fixInlineStyle(el);
            });
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
  document.querySelectorAll('*').forEach(function(el) {
    fixElementAttributes(el);
    fixInlineStyle(el);
  });

  // 监听属性变化
  const attrObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.type === 'attributes') {
        const el = mutation.target;
        const attr = mutation.attributeName;
        if (['src', 'href', 'action', 'data-src', 'data-href', 'poster', 'background', 'cite', 'formaction', 'ping', 'manifest'].includes(attr)) {
          const value = el.getAttribute(attr);
          if (value && value.startsWith('/')) {
            el.setAttribute(attr, PROXY_BASE_URL + value);
          }
        }
      }
    });
  });

  attrObserver.observe(document.documentElement, {
    attributes: true,
    subtree: true,
    attributeFilter: ['src', 'href', 'action', 'data-src', 'data-href', 'poster', 'background', 'cite', 'formaction', 'ping', 'manifest']
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
  // 检查内容类型 - 优先检查明确的文本类型
  if (HTML_CONTENT_TYPES.some(t => contentType.includes(t))) {
    return true;
  }
  if (CSS_CONTENT_TYPES.some(t => contentType.includes(t))) {
    return true;
  }
  if (JS_CONTENT_TYPES.some(t => contentType.includes(t))) {
    return true;
  }

  // 检查文件扩展名 - 二进制文件不重写
  const ext = pathname.split('.').pop()?.toLowerCase();
  if (ext && BINARY_EXTENSIONS.has(ext)) {
    return false;
  }

  // 检查是否是文本类型（包括 JSON、XML 等）
  if (contentType.startsWith('text/') || 
      contentType.includes('json') || 
      contentType.includes('xml') || 
      contentType.includes('javascript') ||
      contentType.includes('+json') ||
      contentType.includes('+xml')) {
    return true;
  }

  // 如果没有 content-type 或者是 application/octet-stream，根据扩展名判断
  if (!contentType || contentType.includes('octet-stream')) {
    if (ext && ['js', 'css', 'html', 'htm', 'json', 'xml', 'svg'].includes(ext)) {
      return true;
    }
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

  // 修改 CSP 以允许内联脚本和从代理加载资源
  const csp = sourceHeaders.get('Content-Security-Policy');
  if (csp) {
    // 保留 CSP 但修改它以允许代理
    const modifiedCsp = csp
      .replace(/script-src[^;]*/gi, 'script-src * \'unsafe-inline\' \'unsafe-eval\' data: blob:')
      .replace(/style-src[^;]*/gi, 'style-src * \'unsafe-inline\'')
      .replace(/img-src[^;]*/gi, 'img-src * data: blob:')
      .replace(/connect-src[^;]*/gi, 'connect-src * blob:')
      .replace(/font-src[^;]*/gi, 'font-src * data:')
      .replace(/media-src[^;]*/gi, 'media-src * blob:')
      .replace(/object-src[^;]*/gi, 'object-src *')
      .replace(/frame-src[^;]*/gi, 'frame-src *')
      .replace(/worker-src[^;]*/gi, 'worker-src * blob:')
      .replace(/base-uri[^;]*/gi, 'base-uri *')
      .replace(/form-action[^;]*/gi, 'form-action *')
      .replace(/manifest-src[^;]*/gi, 'manifest-src *');
    targetHeaders.set('Content-Security-Policy', modifiedCsp);
  } else {
    // 如果没有 CSP，添加一个宽松的
    targetHeaders.set('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; style-src * 'unsafe-inline'; img-src * data: blob:; connect-src * blob:; font-src * data:; media-src * blob:; object-src *; frame-src *; worker-src * blob:;");
  }

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