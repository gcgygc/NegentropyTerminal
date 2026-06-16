import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// FIX: Import `cwd` to resolve the type error for `process.cwd()`.
import { cwd } from 'process';
// FIX: Import `fileURLToPath` to resolve `__dirname` in an ESM context.
import { fileURLToPath } from 'url';

export default defineConfig(({ mode }) => {
    // 加载当前目录下的环境变量
    // 第三个参数 '' 表示加载所有环境变量，不管是否有 VITE_ 前缀
    const env = loadEnv(mode, cwd(), '');
    return {
      // 关键修复: 确保资源引用是相对路径，否则在 Capacitor 中会找不到 index.css 等文件
      base: './',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // 关键修复：
        // 1. 优先读取 API_KEY (Vercel 常用命名)，其次是 GEMINI_API_KEY
        // 2. 确保如果未定义，这里是一个空字符串而不是 undefined，防止构建报错
        'process.env.API_KEY': JSON.stringify(env.API_KEY || env.GEMINI_API_KEY || ''),
      },
      resolve: {
        alias: {
          // FIX: Replace `__dirname` with its ESM-compatible equivalent using `import.meta.url`.
          '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.'),
        }
      }
    };
});
