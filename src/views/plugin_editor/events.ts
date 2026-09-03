/**
 * 插件编辑器内部的窗口事件名集中定义。
 *
 * 这些事件在主编辑器 (editor.tsx)、AST/Regex 表格、AI 判定 hook、诊断卡片
 * 等组件之间跨层通信；字符串散落各文件时拼写错误无法静态发现，故收敛为常量。
 */
export const EDITOR_EVENTS = {
    /** 请求加载当前文件源码 (磁盘/备份 → 内存缓存) */
    LoadSource: 'i18n-load-source',
    /** 源码加载完成 (detail.ok 表示是否成功) */
    SourceLoaded: 'i18n-source-loaded',
    /** 在系统默认编辑器中打开当前文件 */
    OpenSource: 'i18n-open-source',
    /** 广播诊断错误 (表格行高亮) */
    DiagnoseErrors: 'i18n-diagnose-errors',
    /** 跳转到指定错误条目 */
    JumpError: 'i18n-jump-error',
} as const;
