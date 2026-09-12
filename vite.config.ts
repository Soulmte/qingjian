import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  /**
   * Crepe（Milkdown 的编辑器外壳）用 Vue 写成，走的是 esm-bundler 构建。那个构建
   * 期望打包器把三个编译期开关注入成字面量，否则运行时每次启动都会往控制台打一条
   * 警告，而且摇树也摇不掉 dev-only 的分支。Vite 的 `define` 正是这条链路的官方接
   * 口：这里给死值，Vue 源码在构建时就被常量折叠。
   */
  define: {
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  build: {
    rollupOptions: {
      output: {
        /**
         * 把几个大依赖拆出主 chunk。
         *
         * 编辑器内核（Milkdown/ProseMirror）、代码高亮（CodeMirror）、公式排版
         * （KaTeX）加起来比应用自身的代码大得多，全塞进一个文件意味着启动时要
         * 一次性解析完才能显示界面。拆开之后浏览器可以并行下载，各自的缓存也
         * 不会被一次应用改动全部作废。
         *
         * 只按依赖来源分组，不按功能：同一个包被拆到两个 chunk 里会产生循环
         * 引用，那比不拆更糟。
         */
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("katex")) return "katex";

          /**
           * 语法包必须留在组外。
           *
           * Crepe 依赖 `@codemirror/language-data`，它为 20 多种语言各自准备了
           * 一条 `import()`，本来会被拆成一堆按需加载的小 chunk —— 打开一段
           * Rust 代码块才下载 Rust 语法。把 `@codemirror`/`@lezer` 整个归到一
           * 组会连这些动态入口一起吞掉，全部变成启动时就要解析的静态代码
           * （实测 1.6 MB）。所以这里只收内核，`lang-*`、`legacy-modes` 和各语
           * 言的 `@lezer` 语法交给 Rollup 自己保持懒加载。
           */
          if (id.includes("@codemirror/lang-") || id.includes("@codemirror/legacy-modes")) {
            return undefined;
          }
          if (id.includes("@codemirror") || id.includes("@lezer/common") ||
              id.includes("@lezer/highlight") || id.includes("@lezer/lr")) {
            return "codemirror";
          }
          if (id.includes("@lezer")) return undefined;

          if (id.includes("@milkdown") || id.includes("prosemirror")) return "editor";
          if (id.includes("@heroui") || id.includes("react-aria")) return "ui";
          return undefined;
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      //
      // 4. Markdown files too。"工作区就是本仓库"时（开发时很常见），青简
      //    每存一次笔记都会写一个 .md，而这个 .md 在 Vite 的监听范围内，会被
      //    当成「项目文件变了」直接硬刷新整个 webview：界面闪一下，刚才那次
      //    操作（切笔记、新建、重命名）全白做。笔记文件从不进入前端模块图，
      //    所以对它们唯一正确的反应就是什么都不做。
      ignored: ["**/src-tauri/**", "**/*.md", "**/*.markdown"],
    },
  },
}));
