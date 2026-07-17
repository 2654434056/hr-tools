// ===== HR 简历解析 · Cloudflare Pages Function CORS 代理 =====
// 作用：让浏览器里的简历解析工具能调用 DeepSeek / 通义千问 等大模型 API
//      （这些官方接口默认不允许浏览器直接跨域访问，需经此代理转发）。
// 隐私：简历文字只经过「你自己的」这个 Pages Function，再到官方 API，不经任何第三方。
// 部署：把本文件放到仓库 functions/ 目录下，Cloudflare Pages 自动部署为 /proxy/ 路由。
// 工具端「CORS 代理地址」填写： /proxy/?url=  （相对路径，与工具同域，国内不被墙）

export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);

  const origin = request.headers.get("Origin") || "*";
  const cors = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };

  // 1) 浏览器预检请求，直接放行
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  // 2) 取出真实目标地址（工具会自动拼上编码后的官方 API 地址）
  const target = url.searchParams.get("url");

  // 2.5) 没有 url 参数时：浏览器直接打开 → 友好首页；工具调用异常 → 回显诊断
  if (!target) {
    if (request.method === "GET") {
      const home = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>HR AI 代理</title></head><body style="font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px;color:#1a1a1a"><h2>✅ CORS 代理已部署成功</h2><p>这个地址是给你的「简历解析工具」做中转用的，<b>不需要在浏览器里直接打开</b>。</p><p>工具会在「CORS 代理地址」里填：<code>${url.origin}/proxy/?url=</code><br>调用时会自动在后面拼上编码后的官方接口地址。</p><p>想验证转发能力，可访问：<br><a href="${url.origin}/proxy/?url=${encodeURIComponent("https://api.deepseek.com/chat/completions")}">${url.origin}/proxy/?url=…(DeepSeek 地址)</a><br>（此时会真的请求 DeepSeek，返回其原始响应，例如「需要认证」）</p></body></html>`;
      return new Response(home, { status: 200, headers: { ...cors, "Content-Type": "text/html; charset=utf-8" } });
    }
    const diag = ["缺少 url 参数。", "收到的路径：" + url.pathname, "查询串：" + url.search, "", "这是 CORS 代理，请通过简历解析工具的「CORS 代理地址」调用，工具会自动拼上 ?url= 参数。"].join("\n");
    return new Response(diag, { status: 400, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
  }

  // 3) 只允许转发到已知的大模型官方域名，避免被人拿去当开放代理滥用
  const ALLOW = [
    "api.deepseek.com",
    "dashscope.aliyuncs.com",
    "api.openai.com",
  ];
  let host;
  try { host = new URL(target).hostname; } catch (e) {
    return new Response("url 非法", { status: 400, headers: cors });
  }
  if (!ALLOW.includes(host)) {
    return new Response("该目标域名不在白名单", { status: 403, headers: cors });
  }

  // 4) 转发请求（带上原始 method / body / Authorization / Content-Type）
  let resp;
  try {
    const init = {
      method: request.method,
      headers: {
        "Content-Type": request.headers.get("Content-Type") || "application/json",
        "Authorization": request.headers.get("Authorization") || "",
      },
    };
    if (request.method === "POST") {
      init.body = await request.text();
    }
    resp = await fetch(target, init);
  } catch (e) {
    return new Response("代理转发失败：" + e.message, { status: 502, headers: cors });
  }

  // 5) 把官方返回结果带上 CORS 头透传回浏览器（用 text 而非流式 body，避免兼容问题）
  let bodyText;
  try { bodyText = await resp.text(); } catch (e) { bodyText = ""; }
  const out = new Response(bodyText, {
    status: resp.status,
    headers: {
      ...cors,
      "Content-Type": resp.headers.get("Content-Type") || "application/json",
    },
  });
  return out;
}
