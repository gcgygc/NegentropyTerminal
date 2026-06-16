
import React from 'react';

interface MarkdownTextProps {
  text: string;
  className?: string;
  highlightColor?: string;
}

export const MarkdownText: React.FC<MarkdownTextProps> = ({ text, className = "", highlightColor = "text-green-400" }) => {
  if (!text) return null;

  const processText = (input: string) => {
    let output = input;
    
    // 临时存储代码块，防止内容被后续 Markdown 规则误伤
    const codeBlocks: string[] = [];
    const inlineCodes: string[] = [];

    // 1. 提取并保护代码块 (```...```)
    // 使用非贪婪匹配获取代码块内容
    output = output.replace(/```([\s\S]*?)```/g, (match, content) => {
        const placeholder = `___CODE_BLOCK_${codeBlocks.length}___`;
        // 渲染为一个终端风格的代码框
        codeBlocks.push(`<div class="bg-[#111] border border-gray-700 p-3 rounded my-2 text-xs font-mono text-yellow-400 overflow-x-auto whitespace-pre shadow-inner leading-normal">${content}</div>`);
        return placeholder;
    });

    // 2. 提取并保护行内代码 (`...`)
    output = output.replace(/`([^`]+)`/g, (match, content) => {
        const placeholder = `___INLINE_CODE_${inlineCodes.length}___`;
        inlineCodes.push(`<code class="bg-gray-800 text-yellow-500 px-1.5 py-0.5 rounded font-mono text-sm border border-gray-600 mx-1 align-middle">${content}</code>`);
        return placeholder;
    });

    // 3. 基础安全过滤 (移除 script/iframe)
    output = output.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
                   .replace(/<iframe\b[^>]*>([\s\S]*?)<\/iframe>/gim, "");

    // 4. Markdown 语法处理 (此时已没有代码块干扰)
    
    // 标题 (#) - 增加一些边框和间距修饰，使用 highlightColor 保持主题一致
    output = output.replace(/^#\s+(.*$)/gm, `<h1 class="text-xl font-bold ${highlightColor} mt-4 mb-2 border-b border-gray-800 pb-1 tracking-wider">$1</h1>`);
    output = output.replace(/^##\s+(.*$)/gm, `<h2 class="text-lg font-bold ${highlightColor} mt-3 mb-2 tracking-wide">$1</h2>`);
    output = output.replace(/^###\s+(.*$)/gm, `<h3 class="text-base font-bold ${highlightColor} mt-2 mb-1">$1</h3>`);
    output = output.replace(/^####\s+(.*$)/gm, `<h4 class="text-sm font-bold ${highlightColor} mt-2 mb-1">$1</h4>`);

    // 分割线 (---)
    output = output.replace(/^---$/gm, '<hr class="border-gray-800 my-4 border-dashed opacity-50" />');

    // 引用 (>)
    output = output.replace(/^>\s+(.*$)/gm, '<div class="border-l-2 border-gray-600 pl-3 py-1 my-2 text-gray-400 italic bg-gray-900/30 text-sm">$1</div>');

    // 无序列表 (- 或 *) - 使用 Flex 布局对齐
    output = output.replace(/^\s*[-*]\s+(.*$)/gm, '<div class="flex items-start my-1 pl-1"><span class="mr-2 text-gray-500 opacity-70">•</span><span class="flex-1">$1</span></div>');

    // 有序列表 (1. ) - 使用 Flex 布局对齐
    output = output.replace(/^\s*(\d+)\.\s+(.*$)/gm, '<div class="flex items-start my-1 pl-1"><span class="mr-2 text-gray-500 font-mono opacity-70 shrink-0">$1.</span><span class="flex-1">$2</span></div>');

    // 加粗 (**)
    output = output.replace(/\*\*(.*?)\*\*/g, `<strong class="font-bold ${highlightColor} drop-shadow-[0_0_5px_rgba(0,0,0,0.5)]">$1</strong>`);
    
    // 斜体 (*)
    output = output.replace(/(^|[^\w])\*([^*]+)\*([^\w]|$)/g, '$1<em class="italic text-gray-400">$2</em>$3');

    // 删除线 (~~)
    output = output.replace(/~~(.*?)~~/g, '<del class="text-gray-600 decoration-gray-500">$1</del>');

    // 5. 还原被保护的代码块
    output = output.replace(/___INLINE_CODE_(\d+)___/g, (match, index) => inlineCodes[parseInt(index)] || match);
    output = output.replace(/___CODE_BLOCK_(\d+)___/g, (match, index) => codeBlocks[parseInt(index)] || match);

    return output;
  };

  return (
    <div 
      className={`markdown-content ${className} whitespace-pre-wrap break-words leading-relaxed`}
      // 启用 HTML 渲染，同时支持上面转换过的 Markdown 标签
      dangerouslySetInnerHTML={{ __html: processText(text) }}
    />
  );
};

export default MarkdownText;
