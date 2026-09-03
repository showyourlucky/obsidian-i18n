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
        'renderMarkdown', 'setLabel', 'setConfirmText', 'setCancelText',
        // 虚拟 DOM / 框架创建函数：标签名与位置参数由 DOM_CREATE_SHORTHAND_ARGS 排除，不误提
        'createElement', 'cloneElement', 'createElementNS',
        'jsx', 'jsxs', 'jsxDEV', 'h',
        'createElementVNode', 'createBaseVNode', 'createElementBlock', 'createBlock', 'createTextVNode'
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
        /^[A-Z_][A-Z0-9]*(_[A-Z0-9]+)+$/,             // SNAKE_CASE 常量 (屏蔽 SETTINGS_MODE/APP_STATE，但放行 REMOVE/SAVE/DELETE 等自然语言全大写词)
        /^(px|em|rem|vh|vw|auto)$/i,                   // CSS 单位
        /^rgba?\(/i,                                   // RGBA 颜色
        /^\./,                                         // 以点开头 (选择器)
        /\.(png|jpg|gif|svg|css|js|ts|md|json)$/i,     // 文件扩展名
        /^[\w.\/\\-]+\/[\w.\/\\-]+$/,                  // 文件路径
        // DOM/浏览器事件名：这类字符串最终作为 addEventListener 的事件类型参数，翻译后事件监听静默失效
        /^(pointer|touch|mouse|key|drag|wheel|focus|blur|input|change|scroll|resize|select|copy|cut|paste|animation|transition)(cancel|start|end|move|up|down|enter|leave|over|out|in|change)?$/,
        /^(click|dblclick|contextmenu|submit|reset|load|unload|abort|error|hashchange|popstate|message|online|offline|beforeunload|DOMContentLoaded)$/,
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
 * 事件注册方法名
 * 这些方法的第一个字符串参数是事件名，翻译后会导致事件监听静默失效
 * 例如: addEventListener('mousemove', ...) / on('change', ...) / emit('close')
 */
export const EVENT_LISTENER_METHODS = new Set([
    'addEventListener', 'removeEventListener', 'dispatchEvent',
    'on', 'off', 'once', 'emit', 'trigger', 'fire',
    'addListener', 'removeListener', 'prependListener', 'prependOnceListener',
    'subscribe', 'unsubscribe', 'publish'
]);

/**
 * 原生 DOM / 浏览器与常用框架事件名称清单
 * 这些字符串如果被提取翻译，会导致事件监听与交互彻底静默失效
 */
export const DOM_EVENT_NAMES = new Set([
    // Mouse
    'click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'mouseover',
    'mouseout', 'mouseenter', 'mouseleave', 'contextmenu', 'wheel', 'auxclick',
    // Pointer
    'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout',
    'pointerenter', 'pointerleave', 'pointercancel', 'gotpointercapture', 'lostpointercapture',
    // Touch
    'touchstart', 'touchend', 'touchmove', 'touchcancel',
    // Keyboard
    'keydown', 'keyup', 'keypress',
    // Drag & Drop
    'drag', 'dragstart', 'dragend', 'dragenter', 'dragleave', 'dragover', 'drop',
    // Focus
    'focus', 'blur', 'focusin', 'focusout',
    // Form & Input
    'input', 'beforeinput', 'change', 'submit', 'reset', 'invalid', 'search',
    // Clipboard
    'copy', 'cut', 'paste',
    // Composition
    'compositionstart', 'compositionupdate', 'compositionend',
    // Animation & Transition
    'animationstart', 'animationend', 'animationiteration', 'animationcancel',
    'transitionstart', 'transitionend', 'transitionrun', 'transitioncancel',
    // Window / Document / Lifecycle
    'scroll', 'scrollend', 'resize', 'load', 'unload', 'beforeunload', 'error',
    'abort', 'hashchange', 'popstate', 'pageshow', 'pagehide', 'visibilitychange',
    'domcontentloaded', 'readystatechange', 'online', 'offline', 'message', 'storage',
    // Media
    'play', 'pause', 'ended', 'timeupdate', 'volumechange', 'seeking', 'seeked',
    'loadeddata', 'loadedmetadata', 'canplay', 'canplaythrough', 'ratechange',
    'durationchange', 'fullscreenchange', 'fullscreenerror',
    // Obsidian 特有事件名
    'layout-change', 'active-leaf-change', 'file-open', 'quit', 'create',
    'modify', 'delete', 'rename', 'open', 'close', 'split'
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
// 2.5 DOM 结构安全 (类名 / 标签名 / 属性名)
// ============================================================================

/**
 * DOM 创建函数及其「不可翻译」的位置参数索引
 *
 * Obsidian 的 createEl / createDiv / createSpan / createSvg 支持字符串简写:
 *   createDiv("message-segment markdown-rendered") === createDiv({ cls: "message-segment markdown-rendered" })
 * 同时 createEl / createSvg 的第 0 个参数是 HTML 标签名 ("div" / "button")。
 * 二者一旦翻译: CSS 规则失效、querySelector / closest / getElementById 静默失配、
 * 标签名被替换后更是直接无法创建元素。属于不可翻译的 DOM 结构信息。
 */
export const DOM_CREATE_SHORTHAND_ARGS: Record<string, number[]> = {
    createEl: [0, 1],   // 0 = HTML 标签名, 1 = cls 简写
    createSvg: [0, 1],
    createDiv: [0],     // cls 简写
    createSpan: [0],
    // React classic runtime
    createElement: [0],        // 0 = 标签名 ("div")
    cloneElement: [0],         // 0 = 元素引用
    createElementNS: [0, 1],   // 0 = 命名空间, 1 = 标签名
    // React 17+ automatic runtime (minified 后形如 (0,r.jsx)(...))
    jsx: [0],                  // 0 = 标签名
    jsxs: [0],                 // 0 = 标签名
    jsxDEV: [0],               // 0 = 标签名
    // Preact / hyperscript
    h: [0],                    // 0 = 标签名
    // Vue 3 编译产物
    createElementVNode: [0],   // 0 = 标签名
    createBaseVNode: [0],      // 0 = 标签名
    createElementBlock: [0],   // 0 = 标签名
    createBlock: [0],          // 0 = 标签名
};

/**
 * 框架虚拟 DOM 创建函数集合。
 * 这些名字 (尤其 `h`/`jsx`) 过于通用，用户自定义同名函数很常见，
 * 故仅当调用形态符合框架签名 (第 1 实参为 props 对象或 null) 时才按框架调用处理，
 * 否则跳过提取，避免误提取用户代码。
 * 注：createElementNS 第 1 参是命名空间字符串、createTextVNode 无 props 参数，均不在此列。
 */
export const FRAMEWORK_CREATE_FUNCS: ReadonlySet<string> = new Set([
    'createElement', 'cloneElement',
    'jsx', 'jsxs', 'jsxDEV',
    'h',
    'createElementVNode', 'createBaseVNode',
    'createElementBlock', 'createBlock',
]);

/**
 * 结构性对象键：其值是类名 / 选择器 / 标识符 / 机器取值，永远不是 UI 文案
 * 注意：这里不能放 name —— addCommand({ name: "..." }) 正是需要翻译的典型场景
 */
export const STRUCTURAL_KEYS = new Set([
    // 类名与选择器
    'cls', 'class', 'classname', 'classnames', 'classlist', 'selector', 'query', 'queryselector',
    // 标识符
    'id', 'key', 'ref', 'tag', 'for',
    // 样式与资源地址
    'style', 'href', 'src', 'url', 'path',
    // HTML 属性
    'attr', 'type', 'icon', 'target', 'rel', 'role', 'dataset'
]);

/**
 * 仅在 DOM 创建函数上下文中不可翻译的键
 * 例如 createEl('input', { name: 'group1' }) 的 name 是 HTML name 属性 (分组标识)
 *
 * value 不放进上面的全局黑名单: 通用语境下 (如 { value: "Some label" })
 * 它可能就是展示文案，只在 createEl/createDiv 等 DOM 创建函数里才是机器取值
 */
export const DOM_CREATE_STRUCTURAL_KEYS = new Set(['name', 'value']);

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
        "^[\\w.\\/\\\\-]+\\/[\\w.\\/\\\\-]+$",
        "^(pointer|touch|mouse|key|drag|wheel|focus|blur|input|change|scroll|resize|select|copy|cut|paste|animation|transition)(cancel|start|end|move|up|down|enter|leave|over|out|in|change)?$",
        "^(click|dblclick|contextmenu|submit|reset|load|unload|abort|error|hashchange|popstate|message|online|offline|beforeunload|DOMContentLoaded)$"
    ],
    /** 默认有效正则字符串列表 */
    validPatterns: [
        "\\s", "[^\\x00-\\x7F]", "[!?,;:。！？，；：]\\s*$"
    ]
};
