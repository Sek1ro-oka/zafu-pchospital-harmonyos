import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep tracing inside this backend even when a parent directory has another lockfile.
  outputFileTracingRoot: process.cwd(),
  experimental: { cpus: 1 },
  /* 默认会发 `X-Powered-By: Next.js`，等于对外报技术栈（安全审计 F6）。
     nginx 侧也可以用 `proxy_hide_header` 抹掉，这里从源头关掉更省事。 */
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/handbook",
        destination: "/handbook/index.html",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        /* 字体是 `public/` 下的静态文件，Next 对 `public/**` 一律发
           `Cache-Control: public, max-age=0` —— 也就是**每次访问都要回源校验**。
           实测：首页正文要等这个 87 KB 的 Archivo 到位（慢网络下 1.2s），
           而它每次都多一次 304 往返（Slow 4G 是 150ms 起），等于白等。
           `/_next/static/**` 早就是 immutable 了，字体没理由例外。
           注意：**换字体文件时要换文件名**（不带内容哈希，immutable 之后改内容
           浏览器不会再来取）。 */
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
