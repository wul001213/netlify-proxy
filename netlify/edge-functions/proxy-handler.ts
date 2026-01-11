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
  "/news": "https://newsnow-ahm.pages.dev",
  "/x": "https://x.com"
};

// 错误页面模板
const ERROR_HTML_TEMPLATE = (title: string, message: string, details?: string) => `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
            background-color: #f8f9fa;
        }
        .error-container {
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .error-icon {
            font-size: 4rem;
            color: #dc3545;
            margin-bottom: 20px;
        }
        h1 {
            color: #dc3545;
            margin-bottom: 20px;
        }
        .error-message {
            font-size: 1.2rem;
            margin-bottom: 20px;
            color: #666;
        }
        .error-details {
            background: #f8f9fa;
            border-left: 4px solid #dc3545;
            padding: 15px;
            margin: 20px 0;
            text-align: left;
            font-family: monospace;
            font-size: 0.9rem;
            border-radius: 0 4px 4px 0;
        }
        .actions {
            margin-top: 30px;
        }
        .btn {
            display: inline-block;
            padding: 10px 20px;
            margin: 5px;
            background: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            transition: background-color 0.2s;
        }
        .btn:hover {
            background: #0056b3;
        }
        .btn-secondary {
            background: #6c757d;
        }
        .btn-secondary:hover {
            background: #545b62;
        }
        .footer {
            margin-top: 40px;
            text-align: center;
            color: #6c757d;
            font-size: 0.9rem;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">⚠️</div>
        <h1>${title}</h1>
        <div class="error-message">${message}</div>
        ${details ? `<div class="error-details">${details}</div>` : ''}
        <div class="actions">
            <a href="/" class="btn">返回首页</a>
            <button onclick="window.history.back()" class="btn btn-secondary">返回上一页</button>
        </div>
    </div>
    <div class="footer">
        <p>Netlify 反向代理服务</p>
    </div>
</body>
</html>
`;

// 安全的URL解析函数
function safeParseURL(urlString: string, fallback: string = 'https://'): URL {
  try {
    return new URL(urlString);
  } catch (error) {
    // 如果URL解析失败，尝试添加协议
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      try {
        return new URL(fallback + urlString);
      } catch (fallbackError) {
        throw new Error(`Invalid URL: ${urlString}`);
      }
    }
    throw new Error(`Invalid URL: ${urlString}`);
  }
}

// 需要修复路径的内容类型
const HTML_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/xml'
];

// 可能需要修复路径的 CSS 内容类型
const CSS_CONTENT_TYPES = [
  'text/css'
];

// JavaScript 内容类型
const JS_CONTENT_TYPES = [
  'application/javascript',
  'text/javascript',
  'application/x-javascript'
];

// 预编译正则表达式以提高性能
const REGEX_PATTERNS = {
  // 通用资源路径匹配
  RESOURCE_PATH: /(?:src|href|content)=['"](?:\.?\/)?([^"']*\.(css|js|png|jpg|jpeg|gif|svg|webp|ico))["']/gi,
  CSS_URL: /url\(['"]?(?:\.?\/)?([^'")]*\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot))['"]?\)/gi,
  
  // 绝对URL匹配
  ABSOLUTE_URL: /(href|src|action|content)=["']https?:\/\/[^"']*?["']/gi,
  PROTOCOL_RELATIVE_URL: /(href|src|action|content)=["']\/\/[^"']*?["']/gi,
  ROOT_RELATIVE_URL: /(href|src|action|content)=["'](\/[^"']*?)["']/gi,
  
  // CSS中的URL
  CSS_ABSOLUTE_URL: /url\(['"]?(https?:\/\/[^'")]*?)['"]?\)/gi,
  CSS_PROTOCOL_RELATIVE_URL: /url\(['"]?(\/\/[^'")]*?)['"]?\)/gi,
  CSS_ROOT_RELATIVE_URL: /url\(['"]?(\/[^'")]*?)['"]?\)/gi,
  
  // JSON和JavaScript中的路径
  JSON_ABSOLUTE_PATH: /"(url|path|endpoint|src|href)"\s*:\s*"https?:\/\/[^"]*?"/gi,
  JSON_ROOT_PATH: /"(url|path|endpoint|src|href)"\s*:\s*"(\/[^"]*?)"/gi,
  JS_ABSOLUTE_PATH: /['"]https?:\/\/[^"']*?['"]/gi,
  JS_ROOT_PATH: /([^a-zA-Z0-9_])(['"])(\/[^\/'"]+\/[^'"]*?)(['"])/g,
  
  // 视频相关匹配
  VIDEO_SRC: /<video[^>]*src=["']([^"']+)["'][^>]*>/gi,
  VIDEO_SOURCE: /<source[^>]*src=["']([^"']+)["'][^>]*>/gi,
  VIDEO_POSTER: /<video[^>]*poster=["']([^"']+)["'][^>]*>/gi,
  HLS_STREAM: /['"]([^"']*\.(m3u8|ts))["']/gi,
  
  // 懒加载属性
  DATA_SRC: /data-(?:src|href|url|background)=["']([^"']+)["']/gi,
  
  // 特定域名匹配（这些将在运行时动态构建）
  // DOMAIN_SPECIFIC: new RegExp(`pattern`, 'gi')
};

// 特定网站的替换规则 (针对某些站点的特殊处理)
const SPECIAL_REPLACEMENTS: Record<string, Array<{pattern: RegExp, replacement: Function}>> = {
  // x.com (Twitter) 特殊处理 - 复杂的单页应用
  'x.com': [
    // 处理所有静态资源路径
    {
      pattern: /(?:src|href)=['"](?:\.?\/)?([^"']*\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot))["']/gi,
      replacement: (match: string, path: string, ext: string) => {
        if (path.startsWith('http')) return match;
        if (path.startsWith('/')) {
          return match.replace(`"/${path.slice(1)}`, `"/x/${path.slice(1)}`);
        }
        return match.replace(`"${path}`, `"/x/${path}`);
      }
    },
    // 处理 API 请求路径
    {
      pattern: /['"]\/(i\/api|api\/v1|graphql|1\.1|2\/[^"']+)["']/gi,
      replacement: (match: string, path: string) => {
        return `"/x/${path}"`;
      }
    },
    // 处理内联 CSS 中的 url()
    {
      pattern: /url\(['"]?(?:\.?\/)?([^'")]*\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot))['"]?\)/gi,
      replacement: (match: string, path: string) => {
        if (path.startsWith('http')) return match;
        if (path.startsWith('/')) {
          return match.replace(`(/${path.slice(1)}`, `(/x/${path.slice(1)}`);
        }
        return match.replace(`(${path}`, `(/x/${path}`);
      }
    },
    // 处理 CDN 资源
    {
      pattern: /['"]https?:\/\/abs\.twimgr\.com\/([^"']+)["']/gi,
      replacement: (match: string, path: string) => {
        return `"https://abs.twimgr.com/${path}"`; // 保持 CDN 原样
      }
    },
    {
      pattern: /['"]https?:\/\/pbs\.twimg\.com\/([^"']+)["']/gi,
      replacement: (match: string, path: string) => {
        return `"https://pbs.twimg.com/${path}"`; // 保持 CDN 原样
      }
    },
    // 处理相对路径
    {
      pattern: /['"]((?!\.\/|\/|https?:\/\/)[^"']+\.(?:css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot))["']/gi,
      replacement: (match: string, path: string) => {
        return `"/x/${path}"`;
      }
    }
  ],
  // hexo 博客特殊处理 (Vercel 部署)
  'hexo-gally.vercel.app': [
    // 替换所有 /css/, /js/, /images/ 等资源路径
    {
      pattern: /(?:src|href|content)=['"](?:\.?\/)?([^"']*\.(css|js|png|jpg|jpeg|gif|svg|webp|ico))["']/gi,
      replacement: (match: string, path: string, ext: string) => {
        // 如果路径已经以 http 开头，不处理
        if (path.startsWith('http')) return match;
        // 如果路径已经以 / 开头，添加前缀
        if (path.startsWith('/')) {
          return match.replace(`"/${path.slice(1)}`, `"/hexo/${path.slice(1)}`);
        }
        // 相对路径
        return match.replace(`"${path}`, `"/hexo/${path}`);
      }
    },
    // 处理内联 CSS 中的 url()
    {
      pattern: /url\(['"]?(?:\.?\/)?([^'")]*\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot))['"]?\)/gi,
      replacement: (match: string, path: string) => {
        if (path.startsWith('http')) return match;
        if (path.startsWith('/')) {
          return match.replace(`(/${path.slice(1)}`, `(/hexo/${path.slice(1)}`);
        }
        return match.replace(`(${path}`, `(/hexo/${path}`);
      }
    },
    // 处理 Vercel 特殊部署路径，如 /_next/ 资源
    {
      pattern: /(src|href)=["']((?:\/_next\/)[^"']*)["']/gi,
      replacement: (match: string, attr: string, path: string) => {
        return `${attr}="/hexo${path}"`;
      }
    },
    // 处理 Vercel 动态导入的 chunk
    {
      pattern: /"(\/_next\/static\/chunks\/[^"]+)"/gi,
      replacement: (match: string, path: string) => {
        return `"/hexo${path}"`;
      }
    },
    // 处理可能的 Next.js API 路径
    {
      pattern: /"(\/api\/[^"]+)"/gi,
      replacement: (match: string, path: string) => {
        return `"/hexo${path}"`;
      }
    },
    // 修复 Next.js data-script
    {
      pattern: /data-href=["']((?:\/_next\/)[^"']*)["']/gi,
      replacement: (match: string, path: string) => {
        return `data-href="/hexo${path}"`;
      }
    }
  ],
  // TV 站点特殊处理
  'tv.gally.ddns-ip.net': [
    // 替换所有资源路径
    {
      pattern: /(?:src|href|content)=['"](?:\.?\/)?([^"']*\.(css|js|png|jpg|jpeg|gif|svg|webp|ico))["']/gi,
      replacement: (match: string, path: string, ext: string) => {
        if (path.startsWith('http')) return match;
        if (path.startsWith('/')) {
          return match.replace(`"/${path.slice(1)}`, `"/tv/${path.slice(1)}`);
        }
        return match.replace(`"${path}`, `"/tv/${path}`);
      }
    },
    // 处理内联 CSS 中的 url()
    {
      pattern: /url\(['"]?(?:\.?\/)?([^'")]*\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot))['"]?\)/gi,
      replacement: (match: string, path: string) => {
        if (path.startsWith('http')) return match;
        if (path.startsWith('/')) {
          return match.replace(`(/${path.slice(1)}`, `(/tv/${path.slice(1)}`);
        }
        return match.replace(`(${path}`, `(/tv/${path}`);
      }
    }
  ]
};

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const path = url.pathname;

  // 处理 CORS 预检请求 (OPTIONS)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin, Range",
        "Access-Control-Max-Age": "86400",
        "Cache-Control": "public, max-age=86400"
      }
    });
  }

  // 特殊处理 /proxy/ 路径 - 用于代理任意URL
  if (path.startsWith('/proxy/')) {
    try {
      // 从路径中提取目标URL
      let targetUrlString = path.substring('/proxy/'.length).trim();
      
      // 处理空路径
      if (!targetUrlString) {
        return new Response(ERROR_HTML_TEMPLATE(
          "代理参数缺失",
          "请提供要代理的URL，格式：/proxy/https://example.com",
          "示例：/proxy/https://www.google.com"
        ), {
          status: 400,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      // 解码URL（如果已编码）
      try {
        if (targetUrlString.startsWith('http%3A%2F%2F') || 
            targetUrlString.startsWith('https%3A%2F%2F') ||
            targetUrlString.includes('%')) {
          targetUrlString = decodeURIComponent(targetUrlString);
        }
      } catch (decodeError) {
        
      }
      
      // 确保URL以http://或https://开头
      if (!targetUrlString.startsWith('http://') && !targetUrlString.startsWith('https://')) {
        targetUrlString = 'https://' + targetUrlString;
      }
      
      // 使用安全的URL解析
      let targetUrl: URL;
      try {
        targetUrl = safeParseURL(targetUrlString);
      } catch (urlError) {
        return new Response(ERROR_HTML_TEMPLATE(
          "无效的URL",
          "提供的URL格式不正确或无法解析",
          `URL: ${targetUrlString}`
        ), {
          status: 400,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      // 继承原始请求的查询参数
      if (url.search && !targetUrlString.includes('?')) {
        targetUrl.search = url.search;
      }
      
      // 创建代理请求
      const proxyRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: new Headers(request.headers),
        body: request.body,
        redirect: 'manual',
      });
      
      // 设置正确的头部
      proxyRequest.headers.set("Host", targetUrl.host);
      
      // 添加代理相关头部
      const clientIp = context.ip || request.headers.get('x-nf-client-connection-ip') || "";
      proxyRequest.headers.set('X-Forwarded-For', clientIp);
      proxyRequest.headers.set('X-Forwarded-Host', url.host);
      proxyRequest.headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
      
      // 处理编码问题
      proxyRequest.headers.delete('accept-encoding');
      
      // 处理Referer头部
      const referer = request.headers.get('referer');
      if (referer) {
        try {
          const refUrl = new URL(referer);
          const newReferer = `${targetUrl.protocol}//${targetUrl.host}${refUrl.pathname}${refUrl.search}`;
          proxyRequest.headers.set('referer', newReferer);
        } catch(e) {
          // Referer解析失败，忽略错误
        }
      } else {
        proxyRequest.headers.set('referer', `${targetUrl.protocol}//${targetUrl.host}/`);
      }
      
      // 发起代理请求，添加超时处理
      let response: Response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时
        
        response = await fetch(proxyRequest, { 
          signal: controller.signal,
          // 确保不遵循自动重定向
          redirect: 'manual'
        });
        
        clearTimeout(timeoutId);
      } catch (fetchError) {
        
        
        let errorMessage = '网络请求失败';
        if (fetchError instanceof Error) {
          if (fetchError.name === 'AbortError') {
            errorMessage = '请求超时（30秒）';
          } else if (fetchError.message.includes('fetch failed')) {
            errorMessage = '无法连接到目标服务器';
          } else {
            errorMessage = fetchError.message;
          }
        }
        
        return new Response(ERROR_HTML_TEMPLATE(
          "代理请求失败",
          errorMessage,
          `目标URL: ${targetUrl.toString()}`
        ), {
          status: 502,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      // 获取内容类型
      const contentType = response.headers.get('content-type') || '';
      
      // 处理需要内容重写的资源
      const shouldRewrite = HTML_CONTENT_TYPES.some(type => contentType.includes(type)) || 
                           CSS_CONTENT_TYPES.some(type => contentType.includes(type)) ||
                           JS_CONTENT_TYPES.some(type => contentType.includes(type));
      
      // 检查内容长度，避免处理过大的文件
      const contentLength = response.headers.get('content-length');
      const maxRewriteSize = 5 * 1024 * 1024; // 5MB限制
      const shouldSkipRewrite = contentLength && parseInt(contentLength) > maxRewriteSize;
      
      let finalResponse: Response;
      
      if (shouldRewrite && !shouldSkipRewrite) {
        try {
          const clonedResponse = response.clone();
          let content = await clonedResponse.text();
          
          // 为/proxy/路径添加特殊的路径重写处理
          if (HTML_CONTENT_TYPES.some(type => contentType.includes(type))) {
            // 重写所有资源路径，使其也通过代理
            const proxyPrefix = `${url.origin}/proxy/`;
            
            // 1. 处理绝对URL
            content = content.replace(
              REGEX_PATTERNS.ABSOLUTE_URL,
              (match) => {
                const urlMatch = match.match(/https?:\/\/[^"']*/);
                if (urlMatch) {
                  return match.replace(urlMatch[0], `${proxyPrefix}${encodeURIComponent(urlMatch[0])}`);
                }
                return match;
              }
            );
            
            // 2. 处理协议相对URL
            content = content.replace(
              REGEX_PATTERNS.PROTOCOL_RELATIVE_URL,
              (match) => {
                const urlMatch = match.match(/\/\/[^"']*/);
                if (urlMatch) {
                  const fullUrl = `https:${urlMatch[0]}`;
                  return match.replace(urlMatch[0], `${proxyPrefix}${encodeURIComponent(fullUrl)}`);
                }
                return match;
              }
            );
            
            // 3. 处理根相对路径
            content = content.replace(
              REGEX_PATTERNS.ROOT_RELATIVE_URL,
              (match, attr, path) => {
                const fullUrl = `${targetUrl.origin}${path}`;
                return `${attr}="${proxyPrefix}${encodeURIComponent(fullUrl)}"`;
              }
            );
            
            // 4. 处理CSS中的url()
            content = content.replace(
              REGEX_PATTERNS.CSS_ABSOLUTE_URL,
              (match, url) => `url("${proxyPrefix}${encodeURIComponent(url)}")`
            );
            
            content = content.replace(
              REGEX_PATTERNS.CSS_PROTOCOL_RELATIVE_URL,
              (match, url) => {
                const fullUrl = `https:${url}`;
                return `url("${proxyPrefix}${encodeURIComponent(fullUrl)}")`;
              }
            );
            
            content = content.replace(
              REGEX_PATTERNS.CSS_ROOT_RELATIVE_URL,
              (match, path) => {
                const fullUrl = `${targetUrl.origin}${path}`;
                return `url("${proxyPrefix}${encodeURIComponent(fullUrl)}")`;
              }
            );
            
            // 5. 添加动态内容修复脚本
            const fixScript = `
            <script>
            (function() {
              const proxyPrefix = '${proxyPrefix}';
              const targetOrigin = '${targetUrl.origin}';
              
              // 拦截所有网络请求
              const originalFetch = window.fetch;
              window.fetch = function(resource, init) {
                if (typeof resource === 'string') {
                  // 处理相对路径
                  if (resource.startsWith('/')) {
                    resource = proxyPrefix + encodeURIComponent(targetOrigin + resource);
                  } else if (resource.startsWith('http://') || resource.startsWith('https://')) {
                    resource = proxyPrefix + encodeURIComponent(resource);
                  }
                }
                return originalFetch.call(this, resource, init);
              };
              
              // 动态修复新增元素的资源路径
              const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                  mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === 1) {
                      const elements = node.querySelectorAll('script[src], link[href], img[src], a[href], iframe[src]');
                      elements.forEach(function(el) {
                        ['src', 'href'].forEach(function(attr) {
                          const val = el.getAttribute(attr);
                          if (val && (val.startsWith('/') || val.startsWith('http'))) {
                            if (val.startsWith('/')) {
                              el.setAttribute(attr, proxyPrefix + encodeURIComponent(targetOrigin + val));
                            } else {
                              el.setAttribute(attr, proxyPrefix + encodeURIComponent(val));
                            }
                          }
                        });
                      });
                    }
                  });
                });
              });
              
              observer.observe(document.body, {
                childList: true,
                subtree: true
              });
            })();
            </script>
            `;
            
            // 插入修复脚本
            const bodyCloseTagPos = content.lastIndexOf('</body>');
            if (bodyCloseTagPos !== -1) {
              content = content.substring(0, bodyCloseTagPos) + fixScript + content.substring(bodyCloseTagPos);
            } else {
              content += fixScript;
            }
          }
          
          finalResponse = new Response(content, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch (contentError) {
          finalResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }
      } else {
        if (shouldSkipRewrite) {
          const headers = new Headers(response.headers);
          headers.set('X-Proxy-Skipped-Rewrite', 'file-too-large');
          finalResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: headers
          });
        } else {
          finalResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }
      }
      
      // 添加CORS头
      finalResponse.headers.set('Access-Control-Allow-Origin', '*');
      finalResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      finalResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Range');
      
      // 移除安全头部
      finalResponse.headers.delete('Content-Security-Policy');
      finalResponse.headers.delete('Content-Security-Policy-Report-Only');
      finalResponse.headers.delete('X-Frame-Options');
      finalResponse.headers.delete('X-Content-Type-Options');
      
      // 处理重定向
      if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
        const location = response.headers.get('location')!;
        try {
          const redirectedUrl = new URL(location, targetUrl);
          const newLocation = `${url.origin}/proxy/${encodeURIComponent(redirectedUrl.toString())}`;
          finalResponse.headers.set('Location', newLocation);
        } catch (redirectError) {
          
        }
      }
      
      return finalResponse;
    } catch (error) {
      
      return new Response(ERROR_HTML_TEMPLATE(
        "代理服务错误",
        "处理代理请求时发生内部错误",
        error instanceof Error ? error.message : String(error)
      ), {
        status: 500,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }

  // 查找匹配的代理配置
  let targetBaseUrl: string | null = null;
  let matchedPrefix: string | null = null;

  // 倒序遍历，以便更具体的路径（如 /api/v2）优先于 /api
  const prefixes = Object.keys(PROXY_CONFIG).sort().reverse();

  for (const prefix of prefixes) {
    // 确保匹配的是完整的前缀部分，避免 /apixyz 匹配 /api
    if (path === prefix || path.startsWith(prefix + '/')) {
      targetBaseUrl = PROXY_CONFIG[prefix as keyof typeof PROXY_CONFIG];
      matchedPrefix = prefix;
      break; // 找到第一个（最具体的）匹配就停止
    }
  }

  // 如果找到了匹配的规则
  if (targetBaseUrl && matchedPrefix) {
    try {
      // 构造目标 URL
      const remainingPath = path.substring(matchedPrefix.length);
      const targetUrlString = targetBaseUrl.replace(/\/$/, '') + remainingPath;
      const targetUrl = safeParseURL(targetUrlString);

      // 继承原始请求的查询参数
      targetUrl.search = url.search;

      // 获取目标域名，用于特殊处理
      const targetDomain = targetUrl.host;
      const targetOrigin = targetUrl.origin;
      const targetPathBase = targetUrl.pathname.substring(0, targetUrl.pathname.lastIndexOf('/') + 1);

      // 创建代理请求
      const proxyRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: new Headers(request.headers),
        body: request.body,
        redirect: 'manual',
      });

      // 设置正确的头部
      proxyRequest.headers.set("Host", targetUrl.host);
      
      // 添加代理相关头部
      const clientIp = context.ip || request.headers.get('x-nf-client-connection-ip') || "";
      proxyRequest.headers.set('X-Forwarded-For', clientIp);
      proxyRequest.headers.set('X-Forwarded-Host', url.host);
      proxyRequest.headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
      
      // x.com 特殊处理 - 设置必要的头部
      if (targetDomain === 'x.com' || targetDomain === 'twitter.com') {
        proxyRequest.headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        proxyRequest.headers.set('Accept-Language', 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7');
        proxyRequest.headers.set('Sec-Fetch-Dest', 'document');
        proxyRequest.headers.set('Sec-Fetch-Mode', 'navigate');
        proxyRequest.headers.set('Sec-Fetch-Site', 'same-origin');
        proxyRequest.headers.set('Sec-Fetch-User', '?1');
        proxyRequest.headers.set('Upgrade-Insecure-Requests', '1');
      }
      
      proxyRequest.headers.delete('accept-encoding');
      
      const referer = request.headers.get('referer');
      if (referer) {
        try {
          const refUrl = new URL(referer);
          const newReferer = `${targetUrl.protocol}//${targetUrl.host}${refUrl.pathname}${refUrl.search}`;
          proxyRequest.headers.set('referer', newReferer);
        } catch(e) {}
      } else {
        proxyRequest.headers.set('referer', `${targetUrl.protocol}//${targetUrl.host}/`);
      }
      
      let response: Response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        response = await fetch(proxyRequest, { 
          signal: controller.signal,
          redirect: 'manual'
        });
        clearTimeout(timeoutId);
      } catch (fetchError) {
        
        
        let errorMessage = '网络请求失败';
        if (fetchError instanceof Error) {
          if (fetchError.name === 'AbortError') {
            errorMessage = '请求超时（30秒）';
          } else if (fetchError.message.includes('fetch failed')) {
            errorMessage = '无法连接到目标服务器';
          } else {
            errorMessage = fetchError.message;
          }
        }
        
        return new Response(ERROR_HTML_TEMPLATE(
          "代理请求失败",
          errorMessage,
          `目标URL: ${targetUrl.toString()}<br>代理路径: ${matchedPrefix}`
        ), {
          status: 502,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      // 获取内容类型
      const contentType = response.headers.get('content-type') || '';
      
      // 处理需要内容替换的资源类型
      const needsRewrite = HTML_CONTENT_TYPES.some(type => contentType.includes(type)) || 
                           CSS_CONTENT_TYPES.some(type => contentType.includes(type)) ||
                           JS_CONTENT_TYPES.some(type => contentType.includes(type));
      
      // 检查内容长度，避免处理过大的文件
      const contentLength = response.headers.get('content-length');
      const maxRewriteSize = 5 * 1024 * 1024;
      const shouldSkipRewrite = contentLength && parseInt(contentLength) > maxRewriteSize;
      
      let newResponse: Response;
      
      if (needsRewrite && !shouldSkipRewrite) {
        try {
          const clonedResponse = response.clone();
          let content = await clonedResponse.text();
          
          const targetDomain = targetUrl.host;
          const targetOrigin = targetUrl.origin;
          const targetPathBase = targetUrl.pathname.substring(0, targetUrl.pathname.lastIndexOf('/') + 1);
          
          if (HTML_CONTENT_TYPES.some(type => contentType.includes(type))) {
            content = content.replace(
              new RegExp(`(href|src|action|content)=["']https?://${targetDomain}(/[^"']*?)["']`, 'gi'),
              `$1="${url.origin}${matchedPrefix}$2"`
            );
            
            content = content.replace(
              new RegExp(`(href|src|action|content)=["']//${targetDomain}(/[^"']*?)["']`, 'gi'),
              `$1="${url.origin}${matchedPrefix}$2"`
            );
            
            content = content.replace(
              /(href|src|action|content)=["'](\/[^"']*?)["']/gi,
              `$1="${url.origin}${matchedPrefix}$2"`
            );
            
            content = content.replace(
              new RegExp(`url\\(['"]?https?://${targetDomain}(/[^)'"]*?)['"]?\\)`, 'gi'),
              `url(${url.origin}${matchedPrefix}$1)`
            );
            
            content = content.replace(
              new RegExp(`url\\(['"]?//${targetDomain}(/[^)'"]*?)['"]?\\)`, 'gi'),
              `url(${url.origin}${matchedPrefix}$1)`
            );
            
            content = content.replace(
              /url\(['"]?(\/[^)'"]*?)['"]?\)/gi,
              `url(${url.origin}${matchedPrefix}$1)`
            );
            
            // 5. 处理base标签
            content = content.replace(
              new RegExp(`<base[^>]*href=["']https?://${targetDomain}[^"']*["'][^>]*>`, 'gi'),
              `<base href="${url.origin}${matchedPrefix}/">`
            );
            
            content = content.replace(
              /(href|src|action|data-src|data-href)=["']((?!https?:\/\/|\/\/|\/)[^"']+)["']/gi,
              `$1="${url.origin}${matchedPrefix}/${targetPathBase}$2"`
            );
            
            content = content.replace(
              new RegExp(`"(url|path|endpoint|src|href)"\\s*:\\s*"https?://${targetDomain}(/[^"]*?)"`, 'gi'),
              `"$1":"${url.origin}${matchedPrefix}$2"`
            );
            
            content = content.replace(
              /"(url|path|endpoint|src|href)"\s*:\s*"(\/[^"]*?)"/gi,
              `"$1":"${url.origin}${matchedPrefix}$2"`
            );
            
            content = content.replace(
              new RegExp(`['"]https?://${targetDomain}(/[^"']*?)['"]`, 'gi'),
              `"${url.origin}${matchedPrefix}$1"`
            );
            
            content = content.replace(
              /([^a-zA-Z0-9_])(['"])(\/[^\/'"]+\/[^'"]*?)(['"])/g,
              `$1$2${url.origin}${matchedPrefix}$3$4`
            );
            
            content = content.replace(
              /srcset=["']([^"']+)["']/gi,
              (match, srcset) => {
                const newSrcset = srcset.split(',').map((src: string) => {
                  const [srcUrl, descriptor] = src.trim().split(/\s+/);
                  let newUrl = srcUrl;
                  
                  if (srcUrl.startsWith('http://') || srcUrl.startsWith('https://')) {
                    if (srcUrl.includes(targetDomain)) {
                      newUrl = srcUrl.replace(
                        new RegExp(`https?://${targetDomain}(/[^\\s]*)`, 'i'),
                        `${url.origin}${matchedPrefix}$1`
                      );
                    }
                  } else if (srcUrl.startsWith('//')) {
                    if (srcUrl.includes(targetDomain)) {
                      newUrl = srcUrl.replace(
                        new RegExp(`//${targetDomain}(/[^\\s]*)`, 'i'),
                        `${url.origin}${matchedPrefix}$1`
                      );
                    }
                  } else if (srcUrl.startsWith('/')) {
                    newUrl = `${url.origin}${matchedPrefix}${srcUrl}`;
                  }
                  
                  return descriptor ? `${newUrl} ${descriptor}` : newUrl;
                }).join(', ');
                
                return `srcset="${newSrcset}"`;
              }
            );
            
            content = content.replace(
              /(<video[^>]*src=["'])([^"']+)(["'][^>]*>)/gi,
              (match, prefix, src, suffix) => {
                let newSrc = src;
                if (src.startsWith('http://') || src.startsWith('https://')) {
                  if (src.includes(targetDomain)) {
                    newSrc = src.replace(new RegExp(`https?://${targetDomain}(/.*)`, 'i'), `${url.origin}${matchedPrefix}$1`);
                  }
                } else if (src.startsWith('//')) {
                  if (src.includes(targetDomain)) {
                    newSrc = src.replace(new RegExp(`//${targetDomain}(/.*)`, 'i'), `${url.origin}${matchedPrefix}$1`);
                  }
                } else if (src.startsWith('/')) {
                  newSrc = `${url.origin}${matchedPrefix}${src}`;
                } else {
                  newSrc = `${url.origin}${matchedPrefix}/${targetPathBase}${src}`;
                }
                return `${prefix}${newSrc}${suffix}`;
              }
            );
            
            content = content.replace(
              /(<video[^>]*poster=["'])([^"']+)(["'][^>]*>)/gi,
              (match, prefix, poster, suffix) => {
                let newPoster = poster;
                if (poster.startsWith('http://') || poster.startsWith('https://')) {
                  if (poster.includes(targetDomain)) {
                    newPoster = poster.replace(new RegExp(`https?://${targetDomain}(/.*)`, 'i'), `${url.origin}${matchedPrefix}$1`);
                  }
                } else if (poster.startsWith('//')) {
                  if (poster.includes(targetDomain)) {
                    newPoster = poster.replace(
                      new RegExp(`//${targetDomain}(/.*)`, 'i'),
                      `${url.origin}${matchedPrefix}$1`
                    );
                  }
                } else if (poster.startsWith('/')) {
                  newPoster = `${url.origin}${matchedPrefix}${poster}`;
                } else {
                  newPoster = `${url.origin}${matchedPrefix}/${targetPathBase}${poster}`;
                }
                return `${prefix}${newPoster}${suffix}`;
              }
            );
            
            content = content.replace(
              /(<source[^>]*src=["'])([^"']+)(["'][^>]*>)/gi,
              (match, prefix, src, suffix) => {
                let newSrc = src;
                if (src.startsWith('http://') || src.startsWith('https://')) {
                  if (src.includes(targetDomain)) {
                    newSrc = src.replace(new RegExp(`https?://${targetDomain}(/.*)`, 'i'), `${url.origin}${matchedPrefix}$1`);
                  }
                } else if (src.startsWith('//')) {
                  if (src.includes(targetDomain)) {
                    newSrc = src.replace(new RegExp(`//${targetDomain}(/.*)`, 'i'), `${url.origin}${matchedPrefix}$1`);
                  }
                } else if (src.startsWith('/')) {
                  newSrc = `${url.origin}${matchedPrefix}${src}`;
                } else {
                  newSrc = `${url.origin}${matchedPrefix}/${targetPathBase}${src}`;
                }
                return `${prefix}${newSrc}${suffix}`;
              }
            );
            
            content = content.replace(
              /(['"])([^"']*\.(m3u8|ts|mp4|webm|ogg|avi|mov|flv|wmv))(["'])/gi,
              (match, quote1, url, ext, quote2) => {
                let newUrl = url;
                if (url.startsWith('http://') || url.startsWith('https://')) {
                  if (url.includes(targetDomain)) {
                    newUrl = url.replace(new RegExp(`https?://${targetDomain}(/.*)`, 'i'), `${url.origin}${matchedPrefix}$1`);
                  }
                } else if (url.startsWith('//')) {
                  if (url.includes(targetDomain)) {
                    newUrl = url.replace(new RegExp(`//${targetDomain}(/.*)`, 'i'), `${url.origin}${matchedPrefix}$1`);
                  }
                } else if (url.startsWith('/')) {
                  newUrl = `${url.origin}${matchedPrefix}${url}`;
                } else {
                  newUrl = `${url.origin}${matchedPrefix}/${targetPathBase}${url}`;
                }
                return `${quote1}${newUrl}${quote2}`;
              }
            );
            
            // 14. 处理 data-* 属性（懒加载）
            content = content.replace(
              /data-(?:src|href|url|background|poster)=["']([^"']+)["']/gi,
              (match, url) => {
                let newUrl = url;
                if (url.startsWith('http://') || url.startsWith('https://')) {
                  if (url.includes(targetDomain)) {
                    newUrl = url.replace(new RegExp(`https?://${targetDomain}(/.*)`, 'i'), `${url.origin}${matchedPrefix}$1`);
                  }
                } else if (url.startsWith('//')) {
                  if (url.includes(targetDomain)) {
                    newUrl = url.replace(new RegExp(`//${targetDomain}(/.*)`, 'i'), `${url.origin}${matchedPrefix}$1`);
                  }
                } else if (url.startsWith('/')) {
                  newUrl = `${url.origin}${matchedPrefix}${url}`;
                } else {
                  newUrl = `${url.origin}${matchedPrefix}/${targetPathBase}${url}`;
                }
                return `data-${match.split('-')[1]}="${newUrl}"`;
              }
            );
            
            if (SPECIAL_REPLACEMENTS[targetDomain as keyof typeof SPECIAL_REPLACEMENTS]) {
              const replacements = SPECIAL_REPLACEMENTS[targetDomain as keyof typeof SPECIAL_REPLACEMENTS];
              for (const replacement of replacements) {
                try {
                  content = content.replace(replacement.pattern, replacement.replacement as any);
                } catch (replaceError) {}
              }
            }
            
            if (targetDomain === 'x.com' || targetDomain === 'twitter.com') {
              content = content.replace(
                /history\.(pushState|replaceState)\(/gi,
                `history.$1.call(history, `
              );
              
              content = content.replace(
                /['"]\/(i\/api|api\/v1|graphql|1\.1|2\/[^"']+)["']/gi,
                `"${url.origin}${matchedPrefix}/$1"`
              );
              
              content = content.replace(
                /['"]wss?:\/\/[^"']*?\.x\.com[^"']*?["']/gi,
                (match) => match
              );
              
              content = content.replace(
                /navigator\.serviceWorker\.register\(/gi,
                `// Service Worker disabled for proxy; navigator.serviceWorker.register(`
              );
              
              content = content.replace(
                /indexedDB\.open\(/gi,
                `// IndexedDB handling modified for proxy; indexedDB.open(`
              );
              
              content = content.replace(
                /localStorage\.|sessionStorage\./gi,
                `// Storage handling modified for proxy; window.localStorage.`
              );
              
              const xComFixScript = `
            <script>
            // x.com 代理专用修复
            (function() {
              // 禁用 Service Worker
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register = function() {
                  return Promise.resolve();
                };
              }
              
              // 使用 localStorage 模拟 Cookie 功能
              const cookieStorage = {
                get: function() {
                  const cookies = localStorage.getItem('proxy_cookies') || '';
                  return decodeURIComponent(cookies);
                },
                set: function(value) {
                  const existingCookies = localStorage.getItem('proxy_cookies') || '';
                  const cookies = existingCookies ? existingCookies + '; ' + value : value;
                  localStorage.setItem('proxy_cookies', encodeURIComponent(cookies));
                }
              };
              
              // 拦截 Cookie 访问
              const originalCookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
              Object.defineProperty(Document.prototype, 'cookie', {
                get: function() {
                  return cookieStorage.get();
                },
                set: function(value) {
                  cookieStorage.set(value);
                }
              });
              
              // 修复 IndexedDB
              if (window.indexedDB) {
                const originalOpen = indexedDB.open;
                indexedDB.open = function(name, version) {
                  return originalOpen.call(this, 'proxy_' + name, version);
                };
              }
            })();
            </script>
            `;
              
              const headCloseTagPos = content.lastIndexOf('</head>');
              if (headCloseTagPos !== -1) {
                content = content.substring(0, headCloseTagPos) + xComFixScript + content.substring(headCloseTagPos);
              }
            }
              content = content.replace(
                /['"]wss?:\/\/[^"']*?\.x\.com[^"']*?["']/gi,
                (match) => {
                  // x.com 的 WebSocket 连接需要特殊处理
                  // 由于 Edge Functions 不支持完整的 WebSocket 代理，我们保持原样
                  return match;
                }
              );
              
              // 处理 x.com 的 Service Worker
              content = content.replace(
                /navigator\.serviceWorker\.register\(/gi,
                `// Service Worker disabled for proxy; navigator.serviceWorker.register(`
              );
              
              // 处理 x.com 的 IndexedDB
              content = content.replace(
                /indexedDB\.open\(/gi,
                `// IndexedDB handling modified for proxy; indexedDB.open(`
              );
              
              // 处理 x.com 的 localStorage/sessionStorage
              content = content.replace(
                /localStorage\.|sessionStorage\./gi,
                `// Storage handling modified for proxy; window.localStorage.`
              );
              
              // 在 head 中添加 x.com 专用的修复脚本
              const xComFixScript = `
            <script>
            // x.com 代理专用修复
            (function() {
              const PROXY_PREFIX = '${url.origin}${matchedPrefix}';
              const COOKIE_PREFIX = 'proxy_x_';
              
              // 禁用 Service Worker
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register = function() {
                  return Promise.resolve();
                };
              }
              
              // 修复 Cookie 访问 - 使用 localStorage 模拟 Cookie
              const originalCookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
              Object.defineProperty(Document.prototype, 'cookie', {
                get: function() {
                  // 从 localStorage 读取所有代理的 cookie
                  let cookies = '';
                  for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith(COOKIE_PREFIX)) {
                      const cookieName = key.substring(COOKIE_PREFIX.length);
                      const cookieValue = localStorage.getItem(key);
                      cookies += cookieName + '=' + cookieValue + '; ';
                    }
                  }
                  return cookies;
                },
                set: function(value) {
                  // 解析 cookie 并存储到 localStorage
                  const parts = value.split(';')[0].split('=');
                  if (parts.length >= 2) {
                    const name = parts[0].trim();
                    const val = parts.slice(1).join('=').trim();
                    localStorage.setItem(COOKIE_PREFIX + name, val);
                  }
                }
              });
              
              // 修复 IndexedDB
              if (window.indexedDB) {
                const originalOpen = indexedDB.open;
                indexedDB.open = function(name, version) {
                  // 使用代理前缀作为数据库名称前缀
                  return originalOpen.call(this, 'proxy_' + name, version);
                };
              }
            })();
            </script>
            `;
              
              // 在 </head> 之前插入修复脚本
              const headCloseTagPos = content.lastIndexOf('</head>');
              if (headCloseTagPos !== -1) {
                content = content.substring(0, headCloseTagPos) + xComFixScript + content.substring(headCloseTagPos);
              }
            }
            
            // 添加动态修复脚本
            const fixScript = `
            <script>
            (function() {
              const proxyPrefix = '${url.origin}${matchedPrefix}';
              const targetOrigin = '${targetOrigin}';
              const targetHost = '${targetDomain}';
              const isXCom = '${targetDomain}' === 'x.com' || '${targetDomain}' === 'twitter.com';
              
              // 辅助函数：重写URL
              function rewriteUrl(url) {
                if (!url || typeof url !== 'string') return url;
                
                // 如果已经是代理URL，不处理
                if (url.startsWith(proxyPrefix)) return url;
                
                // 处理绝对URL
                if (url.startsWith('http://') || url.startsWith('https://')) {
                  if (url.includes(targetOrigin) || url.includes(targetHost)) {
                    return url.replace(targetOrigin, proxyPrefix).replace(new RegExp('https?://' + targetHost), proxyPrefix);
                  }
                  return url;
                }
                
                // 处理协议相对URL
                if (url.startsWith('//')) {
                  if (url.includes(targetHost)) {
                    return proxyPrefix + url.substring(url.indexOf('/') + 1);
                  }
                  return url;
                }
                
                // 处理根路径
                if (url.startsWith('/')) {
                  return proxyPrefix + url;
                }
                
                // 处理相对路径
                return proxyPrefix + '/' + url;
              }
              
              // 拦截 fetch 请求
              const originalFetch = window.fetch;
              window.fetch = function(resource, init) {
                if (typeof resource === 'string') {
                  resource = rewriteUrl(resource);
                } else if (resource instanceof Request) {
                  const url = resource.url;
                  const rewrittenUrl = rewriteUrl(url);
                  if (rewrittenUrl !== url) {
                    resource = new Request(rewrittenUrl, resource);
                  }
                }
                return originalFetch.call(this, resource, init);
              };
              
              // 拦截 History API (用于单页应用路由)
              if (isXCom) {
                const originalPushState = history.pushState;
                const originalReplaceState = history.replaceState;
                
                history.pushState = function(state, title, url) {
                  if (typeof url === 'string') {
                    // 将代理路径映射回原始路径
                    if (url.startsWith(proxyPrefix)) {
                      url = url.substring(proxyPrefix.length);
                    }
                  }
                  return originalPushState.call(this, state, title, url);
                };
                
                history.replaceState = function(state, title, url) {
                  if (typeof url === 'string') {
                    if (url.startsWith(proxyPrefix)) {
                      url = url.substring(proxyPrefix.length);
                    }
                  }
                  return originalReplaceState.call(this, state, title, url);
                };
                
                // 拦截 popstate 事件
                window.addEventListener('popstate', function(event) {
                  // 处理浏览器后退/前进按钮
                  const currentPath = location.pathname;
                  if (currentPath.startsWith(matchedPrefix)) {
                    // 重定向到正确路径
                    const actualPath = currentPath.substring(matchedPrefix.length);
                    if (actualPath !== currentPath) {
                      history.replaceState(event.state, '', actualPath);
                    }
                  }
                });
              }
              
              // 拦截 XMLHttpRequest
              const originalOpen = XMLHttpRequest.prototype.open;
              XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
                const rewrittenUrl = rewriteUrl(url);
                return originalOpen.call(this, method, rewrittenUrl, async, user, password);
              };
              
              // 拦截 WebSocket
              const originalWebSocket = window.WebSocket;
              window.WebSocket = function(url, protocols) {
                const rewrittenUrl = rewriteUrl(url);
                return new originalWebSocket(rewrittenUrl, protocols);
              };
              
              // 修复元素的属性
              function fixElementAttributes(el) {
                const attributesToFix = ['src', 'href', 'action', 'data-src', 'data-href', 'data-url', 'data-background', 'data-poster', 'poster', 'srcset', 'background'];
                attributesToFix.forEach(attr => {
                  if (el.hasAttribute(attr)) {
                    let val = el.getAttribute(attr);
                    if (val) {
                      // 特殊处理 srcset
                      if (attr === 'srcset') {
                        const newSrcset = val.split(',').map(src => {
                          const [url, descriptor] = src.trim().split(/\\s+/);
                          const rewrittenUrl = rewriteUrl(url);
                          return descriptor ? rewrittenUrl + ' ' + descriptor : rewrittenUrl;
                        }).join(', ');
                        el.setAttribute(attr, newSrcset);
                      } else {
                        el.setAttribute(attr, rewriteUrl(val));
                      }
                    }
                  }
                });
                
                // 修复内联样式中的 url()
                if (el.hasAttribute('style')) {
                  let style = el.getAttribute('style');
                  style = style.replace(/url\\(['"]?([^'")]+)['"]?\\)/gi, (match, url) => {
                    return 'url(' + rewriteUrl(url) + ')';
                  });
                  el.setAttribute('style', style);
                }
              }
              
              // 修复现有元素
              function fixExistingElements() {
                const elements = document.querySelectorAll('script[src], link[href], img[src], a[href], iframe[src], video[src], video[poster], source[src], [data-src], [data-href], [data-url], [data-background], [data-poster], [background]');
                elements.forEach(fixElementAttributes);
              }
              
              // 动态修复新增元素
              const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                  if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(function(node) {
                      if (node.nodeType === 1) {
                        // 修复节点本身的属性
                        fixElementAttributes(node);
                        // 修复节点内部的元素
                        const elements = node.querySelectorAll('script[src], link[href], img[src], a[href], iframe[src], video[src], video[poster], source[src], [data-src], [data-href], [data-url], [data-background], [data-poster], [background]');
                        elements.forEach(fixElementAttributes);
                      }
                    });
                  } else if (mutation.type === 'attributes') {
                    // 修复属性变化
                    fixElementAttributes(mutation.target);
                  }
                });
              });
              
              // 启动观察器
              function startObserver() {
                observer.observe(document.documentElement, {
                  childList: true,
                  subtree: true,
                  attributes: true,
                  attributeFilter: ['src', 'href', 'data-src', 'data-href', 'data-url', 'data-background', 'data-poster', 'poster', 'style', 'srcset', 'background']
                });
              }
              
              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function() {
                  fixExistingElements();
                  startObserver();
                });
              } else {
                fixExistingElements();
                startObserver();
              }
              
              // 拦截动态创建的元素
              const originalCreateElement = document.createElement;
              document.createElement = function(tagName) {
                const element = originalCreateElement.call(this, tagName);
                const originalSetAttribute = element.setAttribute;
                element.setAttribute = function(name, value) {
                  if (['src', 'href', 'action', 'data-src', 'data-href', 'data-url', 'data-background', 'data-poster', 'poster', 'srcset', 'background'].includes(name)) {
                    value = rewriteUrl(value);
                  }
                  return originalSetAttribute.call(this, name, value);
                };
                return element;
              };
            })();
            </script>
            `;
            
            // 插入修复脚本
            const bodyCloseTagPos = content.lastIndexOf('</body>');
            if (bodyCloseTagPos !== -1) {
              content = content.substring(0, bodyCloseTagPos) + fixScript + content.substring(bodyCloseTagPos);
            } else {
              content += fixScript;
            }
          }
          
          // CSS 内容处理
          if (CSS_CONTENT_TYPES.some(type => contentType.includes(type))) {
            const cssPath = targetUrl.pathname;
            const cssDir = cssPath.substring(0, cssPath.lastIndexOf('/') + 1);
            
            // 1. 替换绝对路径
            content = content.replace(
              new RegExp(`url\\(['"]?https?://${targetDomain}(/[^)'"]*?)['"]?\\)`, 'gi'),
              `url(${url.origin}${matchedPrefix}$1)`
            );
            
            // 2. 替换协议相对路径
            content = content.replace(
              new RegExp(`url\\(['"]?//${targetDomain}(/[^)'"]*?)['"]?\\)`, 'gi'),
              `url(${url.origin}${matchedPrefix}$1)`
            );
            
            // 3. 替换根路径
            content = content.replace(
              /url\(['"]?(\/[^)'"]*?)['"]?\)/gi,
              `url(${url.origin}${matchedPrefix}$1)`
            );
            
            // 4. 替换相对路径（处理 ../ 和 ./）
            content = content.replace(
              /url\(['"]?(?!https?:\/\/|\/\/|\/|data:|#|blob:)([^)'"]+)['"]?\)/gi,
              (match, relativePath) => {
                // 解析相对路径
                let resolvedPath = cssDir + relativePath;
                // 处理 ../ 路径
                const pathParts = resolvedPath.split('/').filter(part => part !== '');
                const newPathParts = [];
                for (const part of pathParts) {
                  if (part === '..') {
                    newPathParts.pop();
                  } else {
                    newPathParts.push(part);
                  }
                }
                resolvedPath = '/' + newPathParts.join('/');
                return `url(${url.origin}${matchedPrefix}${resolvedPath})`;
              }
            );
            
            // 5. 处理 @import 规则
            content = content.replace(
              /@import\s+(['"])([^'"]+)(['"])/gi,
              (match, quote1, importUrl, quote2) => {
                let newUrl = importUrl;
                if (importUrl.startsWith('http://') || importUrl.startsWith('https://')) {
                  if (importUrl.includes(targetDomain)) {
                    newUrl = importUrl.replace(
                      new RegExp(`https?://${targetDomain}(/.*)`, 'i'),
                      `${url.origin}${matchedPrefix}$1`
                    );
                  }
                } else if (importUrl.startsWith('//')) {
                  if (importUrl.includes(targetDomain)) {
                    newUrl = importUrl.replace(
                      new RegExp(`//${targetDomain}(/.*)`, 'i'),
                      `${url.origin}${matchedPrefix}$1`
                    );
                  }
                } else if (importUrl.startsWith('/')) {
                  newUrl = `${url.origin}${matchedPrefix}${importUrl}`;
                } else {
                  // 相对路径
                  let resolvedPath = cssDir + importUrl;
                  const pathParts = resolvedPath.split('/').filter(part => part !== '');
                  const newPathParts = [];
                  for (const part of pathParts) {
                    if (part === '..') {
                      newPathParts.pop();
                    } else {
                      newPathParts.push(part);
                    }
                  }
                  resolvedPath = '/' + newPathParts.join('/');
                  newUrl = `${url.origin}${matchedPrefix}${resolvedPath}`;
                }
                return `@import ${quote1}${newUrl}${quote2}`;
              }
            );
          }
          
          // JavaScript 内容处理
          if (JS_CONTENT_TYPES.some(type => contentType.includes(type))) {
            const jsPath = targetUrl.pathname;
            const jsDir = jsPath.substring(0, jsPath.lastIndexOf('/') + 1);
            
            // 1. 替换绝对路径
            content = content.replace(
              new RegExp(`(['"])https?://${targetDomain}(/[^'"]*?)(['"])`, 'gi'),
              `$1${url.origin}${matchedPrefix}$2$3`
            );
            
            // 2. 替换协议相对路径
            content = content.replace(
              new RegExp(`(['"])//${targetDomain}(/[^'"]*?)(['"])`, 'gi'),
              `$1${url.origin}${matchedPrefix}$2$3`
            );
            
            // 3. 替换根路径（包括更多资源类型）
            const resourceExtensions = 'js|css|png|jpg|jpeg|gif|svg|webp|ico|mp3|mp4|webm|ogg|avi|mov|flv|wmv|m3u8|ts|woff|woff2|ttf|eot|json|xml|html|htm';
            content = content.replace(
              new RegExp(`(['"])(\\/[^'"]*?\\.(?:${resourceExtensions}))(['"])`, 'gi'),
              `$1${url.origin}${matchedPrefix}$2$3`
            );
            
            // 4. 处理相对路径（包含 ../ 和 ./）
            content = content.replace(
              new RegExp(`(['"])(?!https?:\\/\\/|\\/\\/|\\/|data:|#|blob:)([^'"]*?\\.(?:${resourceExtensions}))(['"])`, 'gi'),
              (match, quote1, relativePath, quote2) => {
                // 解析相对路径
                let resolvedPath = jsDir + relativePath;
                // 处理 ../ 路径
                const pathParts = resolvedPath.split('/').filter(part => part !== '');
                const newPathParts = [];
                for (const part of pathParts) {
                  if (part === '..') {
                    newPathParts.pop();
                  } else {
                    newPathParts.push(part);
                  }
                }
                resolvedPath = '/' + newPathParts.join('/');
                return `${quote1}${url.origin}${matchedPrefix}${resolvedPath}${quote2}`;
              }
            );
            
            // 5. 处理 JSON 对象中的路径
            content = content.replace(
              new RegExp(`"(url|path|endpoint|src|href|video|audio|image)"\\s*:\\s*"https?://${targetDomain}(/[^"]*?)"`, 'gi'),
              `"$1":"${url.origin}${matchedPrefix}$2"`
            );
            
            content = content.replace(
              /"(url|path|endpoint|src|href|video|audio|image)"\s*:\s*"(\/[^"]*?)"/gi,
              `"$1":"${url.origin}${matchedPrefix}$2"`
            );
          }
          
          newResponse = new Response(content, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch (contentError) {
          
          // 如果内容重写失败，返回原始响应
          newResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }
      } else {
        // 对于大文件或不需要重写的文件，使用流式处理
        if (shouldSkipRewrite) {
          // 创建一个新的响应，添加大文件标记头
          const headers = new Headers(response.headers);
          headers.set('X-Proxy-Skipped-Rewrite', 'file-too-large');
          newResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: headers
          });
        } else {
          newResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }
      }
      
      // 添加 CORS 头
      newResponse.headers.set('Access-Control-Allow-Origin', '*');
      newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Range');
      
      // x.com 特殊处理 - 保留重要的响应头部
      if (targetDomain === 'x.com' || targetDomain === 'twitter.com') {
        // 保留 Set-Cookie 头部（如果存在）
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
          // 将 Set-Cookie 转换为可以通过 CORS 传递的格式
          // 注意：实际应用中可能需要更复杂的处理
          newResponse.headers.set('X-Original-Set-Cookie', setCookie);
        }
        
        // 保留其他重要的头部
        const xCsrfToken = response.headers.get('x-csrf-token');
        if (xCsrfToken) {
          newResponse.headers.set('X-CSRF-Token', xCsrfToken);
        }
        
        // 设置更宽松的缓存策略
        newResponse.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
      
      // 移除可能导致问题的安全头部
      newResponse.headers.delete('Content-Security-Policy');
      newResponse.headers.delete('Content-Security-Policy-Report-Only');
      newResponse.headers.delete('X-Frame-Options');
      newResponse.headers.delete('X-Content-Type-Options');
      
      // 确保不缓存可能包含动态内容的响应
      if (HTML_CONTENT_TYPES.some(type => contentType.includes(type))) {
        newResponse.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        newResponse.headers.set('Pragma', 'no-cache');
        newResponse.headers.set('Expires', '0');
      } else {
        // 对于静态资源，设置较长的缓存时间
        newResponse.headers.set('Cache-Control', 'public, max-age=86400'); // 1天
      }
      
      // 如果目标服务器返回重定向，需要构造正确的重定向URL
      if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
          const location = response.headers.get('location')!;
          const redirectedUrl = new URL(location, targetUrl); // 解析相对或绝对 Location

          // 如果重定向回代理源本身，则需要重写为原始主机名下的路径
          if (redirectedUrl.origin === targetUrl.origin) {
              const newLocation = url.origin + matchedPrefix + redirectedUrl.pathname + redirectedUrl.search;
              context.log(`Rewriting redirect from ${location} to ${newLocation}`);
              newResponse.headers.set('Location', newLocation);
          } else {
              // 如果重定向到外部域，则直接使用
              context.log(`Proxying redirect to external location: ${location}`);
          }
      }
      
      return newResponse;

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
  }

  // 如果没有匹配的代理规则，则不处理此请求，交由 Netlify 的其他规则处理
  return;
}; 