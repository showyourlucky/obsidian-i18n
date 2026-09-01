/**
 * 核心提取配置聚合文件
 * 统一管理 AST 和 Regex 提取所需的白名单、过滤规则及默认正则
 */

// ============================================================================
// 1. AST 提取相关配置
// ============================================================================

export const AST_DEFAULT_CONFIG = {
    // 变量赋值白名单 (例如: const title = "...")
    assignments: [
        'overwriteName', 'innerHTML', 'outerHTML', 'title', 'alt', 'placeholder',
        'textContent', 'innerText', 'ariaLabel', 'nodeValue', 'buttonText',
        'confirmText', 'cancelText', 'labelText'
    ],
    // 函数调用白名单
    functions: [
        'Notice', 'setTitle', 'setContent', 'setName', 'setDesc', 'setButtonText',
        'setPlaceholder', 'setTooltip', 'addOption', 'addOptions', 'addHeading', 'addText',
        'setHint', 'setWarning', 'setText', 'appendText', 'createEl', 'createDiv',
        'createSpan', 'addCommand', 'insertText', 'replaceRange', 'replaceSelection',
        'log', 'error', 'warn', 'info', 'alert', 'confirm', 'prompt',
        'renderMarkdown', 'setLabel', 'setConfirmText', 'setCancelText'
    ],
    // 对象键名白名单
    keys: [
        'name', 'description', 'text', 'placeholder', 'label', 'tooltip', 'title',
        'header', 'desc', 'message', 'buttontext', 'aria-label', 'heading', 'content',
        'tab', 'caption', 'subtitle', 'summary', 'info', 'warning', 'error', 'success',
        'hint', 'instructions', 'link', 'selection', 'annotation', 'search', 'speech',
        'page', 'empty', 'detail', 'body', 'option', 'notice', 'confirmText',
        'cancelText', 'ariaLabel', 'buttonText'
    ]
};

/** AST 提取的内容过滤规则 (正则表达式对象) */
export const AST_DEFAULT_RULES = {
    REJECT_PATTERNS: [
        /^\s*$/,                                      // 空白
        /^\d+$/,                                      // 纯数字
        /^[\w-]+\.[\w-]+\.\w+$/,                       // 三段式 ID (如 a.b.c)
        /^https?:\/\//i,                               // URL
        /^data:image\//i,                             // Base64 图片
        /^#([0-9a-f]{3}|[0-9a-f]{6})$/i,               // 十六进制颜色
        /^[a-z0-9]+-[a-z0-9-]+$/,                      // 包含连字符的 kebab-case (通常是 ID)
        /^[a-z]+[A-Z][a-zA-Z0-9]*$/,                   // camelCase (变量名)
        /^[A-Z_][A-Z0-9_]{3,}$/,                       // 长大写常量 (屏蔽如 SETTINGS_MODE，但保留 OK)
        /^(px|em|rem|vh|vw|auto)$/i,                   // CSS 单位
        /^rgba?\(/i,                                   // RGBA 颜色
        /^\./,                                         // 以点开头 (选择器)
        /\.(png|jpg|gif|svg|css|js|ts|md|json)$/i,     // 文件扩展名
        /^[\w.\/\\-]+\/[\w.\/\\-]+$/                   // 文件路径
    ],
    VALID_PATTERNS: [
        /\s/,                                          // 包含空格 (通常是人类语言句子)
        /[^\x00-\x7F]/,                                // 包含非 ASCII 字符 (如中文)
        /[!?,;:。！？，；：]\s*$/                        // 以标点符号结尾
    ]
};

// ============================================================================
// 2. 翻译安全策略 (上下文校验)
// ============================================================================

/**
 * 参与逻辑判断的字符串方法
 * 出现在这些方法实参位置的字符串属于「程序逻辑」而非 UI 文案，翻译后会导致判断/比较/分支失效
 */
export const LOGIC_STRING_METHODS = new Set([
    'startsWith', 'endsWith', 'includes', 'indexOf', 'lastIndexOf',
    'match', 'test', 'search', 'localeCompare', 'replace', 'split'
]);

/**
 * 翻译后会破坏语言机制 / 模块互操作的硬编码依赖词
 * 例如 esbuild 的 __toESM 辅助函数使用 Object.defineProperty(n, "default", {...})，
 * 一旦把 "default" 翻译掉，React 等 CJS 模块的 default 导出即失效 (BUG-001)
 */
export const HARDCODED_WORDS = new Set([
    'default', 'value', 'string', 'module', 'exports', 'require',
    'client', 'strict', 'production', 'development', 'constructor',
    'prototype', 'toString', 'valueOf'
]);

/** 判定为「程序逻辑」的二元运算符 (比较 + 成员判定) */
export const LOGIC_BINARY_OPERATORS = new Set(['===', '!==', '==', '!=', 'in', 'instanceof']);

// ============================================================================
// 3. Regex 提取相关配置
// ============================================================================

export const REGEX_DEFAULT_CONFIG = {
    /** 核心匹配正则表达式字符串 (支持转义引号) */
    patterns: [
        "(Notice|log|error|setText|setButtonText|setName|setDesc|setPlaceholder|setTooltip|appendText|setTitle|addHeading|renderMarkdown)\\(\\s*(['\"`])((?:[^\\\\2\\\\\\\\]|\\\\\\\\.)*?)\\2\\s*\\)",
        "(textContent|innerText|name|description|selection|annotation|link|text|search|speech|page|settings)\\s*[:=]\\s*(['\"`])((?:[^\\\\2\\\\\\\\]|\\\\\\\\.)*?)\\2"
    ],
    /** 默认排除正则字符串列表 */
    rejectPatterns: [
        "^\\s*$", "^\\d+$", "^[\\w-]+\\.[\\w-]+\\.\\w+$", "^https?:\\/\\/",
        "^data:image\\/", "^#([0-9a-f]{3}|[0-9a-f]{6})$", "^[a-z0-9]+-[a-z0-9-]+$",
        "^[a-z]+[A-Z][a-zA-Z0-9]*$", "^[A-Z_][A-Z0-9_]{3,}$", "^(px|em|rem|vh|vw|auto)$",
        "^rgba?\\(", "^\\.", "\\.(png|jpg|gif|svg|css|js|ts|md|json)$",
        "^[\\w.\\/\\\\-]+\\/[\\w.\\/\\\\-]+$"
    ],
    /** 默认有效正则字符串列表 */
    validPatterns: [
        "\\s", "[^\\x00-\\x7F]", "[!?,;:。！？，；：]\\s*$"
    ]
};
