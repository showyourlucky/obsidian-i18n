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

/**
 * 内容过滤规则 —— 共享数据源
 *
 * AST 与 Regex 两条提取路径此前各自维护一份，已经出现实质漂移：Regex 侧的 SNAKE_CASE 规则
 * 写成 ^[A-Z_][A-Z0-9_]{3,}$，会把 SAVE / DELETE / REMOVE 这类自然语言全大写词一并拒掉，
 * 而 AST 侧刻意放行它们。统一为单一数据源，由两侧各自构造，杜绝再次漂移。
 *
 * 每项为 [模式, 是否大小写不敏感]。
 * 注：Regex 侧与设置界面只取模式字符串 (JS 正则不支持 (?i) 内联标志)，故需要忽略大小写的规则
 * 一律在模式内用字符类表达 (如颜色值的 [0-9a-fA-F])，不能依赖 i 标志。
 */
export const SHARED_REJECT_RULES: Array<[string, boolean]> = [
    ['^\\s*$', false],                              // 空白
    ['^\\d+$', false],                              // 纯数字
    ['^[\\w-]+\\.[\\w-]+\\.\\w+$', false],          // 三段式 ID (如 a.b.c)
    ['^https?:\\/\\/', true],                       // URL
    ['^data:image\\/', true],                       // Base64 图片
    ['^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$', true],   // 十六进制颜色
    ['^[a-z0-9]+-[a-z0-9-]+$', false],              // 包含连字符的 kebab-case (通常是 ID)
    ['^[a-z]+[A-Z][a-zA-Z0-9]*$', false],           // camelCase (变量名)
    ['^[A-Z_][A-Z0-9]*(_[A-Z0-9]+)+$', false],      // SNAKE_CASE 常量 (屏蔽 SETTINGS_MODE/APP_STATE，但放行 REMOVE/SAVE/DELETE 等自然语言全大写词)
    ['^(px|em|rem|vh|vw|auto)$', true],             // CSS 单位
    ['^rgba?\\(', true],                            // RGBA 颜色
    ['^\\.', false],                                // 以点开头 (选择器)
    ['\\.(png|jpg|gif|svg|css|js|ts|md|json)$', true], // 文件扩展名
    ['^[\\w.\\/\\\\-]+\\/[\\w.\\/\\\\-]+$', false], // 文件路径
    // DOM/浏览器事件名：这类字符串最终作为 addEventListener 的事件类型参数，翻译后事件监听静默失效
    ['^(pointer|touch|mouse|key|drag|wheel|focus|blur|input|change|scroll|resize|select|copy|cut|paste|animation|transition)(cancel|start|end|move|up|down|enter|leave|over|out|in|change)?$', false],
    ['^(click|dblclick|contextmenu|submit|reset|load|unload|abort|error|hashchange|popstate|message|online|offline|beforeunload)$', false]
];

/** AST 提取的内容过滤规则 (正则表达式对象) */
export const AST_DEFAULT_RULES = {
    REJECT_PATTERNS: SHARED_REJECT_RULES.map(([pattern, ignoreCase]) => new RegExp(pattern, ignoreCase ? 'i' : '')),
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

/**
 * 非可译属性名黑名单 —— 一级：语义上确定是机器取值，任何上下文都不可能是 UI 文案。
 *
 * 收录标准：属性名自带强领域语义 (CSS 尺寸 / HTML 行为 / SVG 绘制 / CSS 类名 / ARIA 状态)，
 * 换成人类语言的概率极低。
 *
 * 这一级会作用于 isStructuralKey 的全部调用点，包括 isStructuralContext 的「全文件扫描」
 * 以及 translate() / traceUsage() 的替换与诊断路径，故只放确定项。
 */
export const MACHINE_VALUED_PROP_NAMES = new Set([
    // CSS 尺寸 / 盒模型 / 视觉表现
    'width', 'height', 'minwidth', 'maxwidth', 'minheight', 'maxheight',
    'padding', 'margin', 'gap', 'inset', 'zindex', 'borderradius', 'radius',
    'opacity', 'transform', 'cursor', 'transition', 'animation',
    'justifycontent', 'alignitems', 'alignself', 'aligncontent', 'flexdirection',
    'flexwrap', 'display', 'overflow', 'overflowx', 'overflowy', 'objectfit',
    'textalign', 'verticalalign', 'whitespace', 'textoverflow', 'wordbreak',
    // 浏览器 / HTML 行为属性
    'autocorrect', 'autocomplete', 'autocapitalize', 'decoding',
    'inputmode', 'enterkeyhint', 'spellcheck', 'contenteditable',
    'draggable', 'tabindex', 'htmlfor',
    // SVG 绘制属性 (几何 / 笔触，永远不是文案)
    // 注意：路径数据属性 'd' 不在此列——单字母名存在歧义 (插件可能用它承载文案)，
    // 且 path data 只能按「值形状」拦截，形状规则一旦内置就会误伤 "M 2 minutes" / "M2 芯片" 等真实文案，
    // 故交由用户在设置里用 astRejectRe 自行添加 (如 ^[Mm][\d\s.,+-]{0,4}\d$)
    'viewbox', 'fillrule', 'fillopacity', 'cliprule', 'clippath',
    'strokelinecap', 'strokelinejoin', 'strokewidth', 'strokedasharray',
    'strokedashoffset', 'strokemiterlimit', 'strokeopacity',
    'preserveaspectratio', 'pathlength', 'xmlns', 'xmlnsxlink',
    'markerend', 'markerstart', 'markermid', 'gradientunits',
    'gradienttransform', 'spreadmethod', 'patternunits', 'filterunits',
    'primitiveunits', 'edgemode',
]);

/**
 * 非可译属性名黑名单 —— 二级：通常是组件枚举，但在部分插件里会承载真实文案。
 *
 * 存在的理由：框架创建函数 (createElement / jsx / h …) 的深层提取只按 isStructuralKey 过滤，
 * 会把 React 组件 props 的枚举值 ({ variant: 'ghost', side: 'bottom' }) 当文案抽出。
 * 这些值在内容层面无法拦截——isValidText 的兜底 /^[A-Za-z]{2,}$/ 对 'ghost'(枚举) 与
 * 'Save'(按钮文案) 完全同形，只能按「属性名」拦。且靠枚举值永远补不完
 * (variant 下还有 ghost/secondary/destructive/…)，按名拦才能一并覆盖未见过的变体。
 *
 * 为什么不能并入一级：下列名字在中文插件里常承载真实文案
 * ({ points: '积分' } / { status: '已连接' } / { loading: '加载中…' } / { translate: '翻译' })。
 * 一级会作用于 isStructuralContext，而它的返回值在 translate() / traceUsage() 里是硬性跳过条件
 * (见 core-ast-translator.ts:183、228)——一旦误判，已翻好的译文会静默失效，
 * 冗余诊断还会把仍在使用的条目误报为「未使用」。故这一级只在框架创建函数的 props 上生效。
 */
export const FRAMEWORK_ONLY_PROP_NAMES = new Set([
    // 组件枚举 (设计系统 token：variant / side / size / status …)
    'align', 'direction', 'orientation', 'side', 'size', 'sectiontype',
    'status', 'viewmode', 'variant', 'placement', 'position', 'justify',
    'loading', 'shadow', 'translate',
    // SVG 语境下确定，但脱离 SVG 就可能承载文案的名字
    'fill', 'stroke', 'points',
]);
// 注：个别插件的私有属性名 (如某些打包产物里的 ext / KCn) 不进默认表——
// 通用性存疑，一旦内置就可能误杀同名但承载文案的属性。
// 交由用户在设置里用 astNonTranslatableProps 自行添加。

/**
 * aria-* 中确实承载可译文案的属性。
 * 前缀规则 (见 isMachineValuedPropName) 会把 aria-* 整体视为状态/枚举，
 * 这几个是例外——它们的值是给读屏软件念的文本，必须保留提取。
 * aria-current 也在其中：规范允许其值为任意 token，不全是 page/step 等枚举。
 */
export const TRANSLATABLE_ARIA_KEYS = new Set([
    'aria-label', 'aria-description', 'aria-placeholder',
    'aria-valuetext', 'aria-roledescription', 'aria-errormessage',
    'aria-current',
]);

/** 属性名族规则 (模块级编译，避免在 AST 热路径上反复构造) */
const CSS_CLASS_SUFFIX_RE = /(classname|classnames|classes|cls)$/;
const CAMEL_BOUNDARY_RE = /[A-Z]/g;

/**
 * 一级判定：属性名的值在任何上下文下都「永远是机器取值」。
 *
 * 采用「枚举 + 族规则」双层：
 *   1. 显式清单 MACHINE_VALUED_PROP_NAMES：已观测到的属性名
 *   2. 族规则：CSS 类名后缀、aria-* 状态前缀——覆盖未观测到的同族属性
 *
 * @param key 对象属性名的原始写法 (保留大小写——aria 驼峰归一化依赖它，内部再折叠为小写)
 */
export function isMachineValuedPropName(key: string): boolean {
    const raw = key || '';
    if (!raw) return false;
    const k = raw.toLowerCase();

    if (MACHINE_VALUED_PROP_NAMES.has(k)) return true;

    // CSS 类名族：iconClassName / buttonClassName / wrapperClasses / itemCls …
    // 用户只列出了 iconClassName 与 buttonClassName，同类命名在各插件里层出不穷，按后缀一并屏蔽。
    if (CSS_CLASS_SUFFIX_RE.test(k)) return true;

    // ARIA 状态族：除少数承载文案的 aria-* 外，其余 (aria-hidden / aria-live / aria-expanded …)
    // 的值都是状态与枚举，按前缀屏蔽并放行 TRANSLATABLE_ARIA_KEYS 白名单。
    // React 里 aria-* 常写成驼峰 (ariaHidden / ariaExpanded)，先归一化成 kebab 再判定，否则整族漏网。
    // 归一化必须在 toLowerCase 之前做——小写化会抹掉驼峰边界，之后无法还原。
    const ariaKey = raw.replace(CAMEL_BOUNDARY_RE, c => '-' + c.toLowerCase()).toLowerCase();
    if (ariaKey.startsWith('aria-') && !TRANSLATABLE_ARIA_KEYS.has(ariaKey)) return true;

    return false;
}

/**
 * 二级判定：属性名「通常是组件枚举」，但部分插件会用它承载真实文案。
 * 只在框架创建函数 (createElement / jsx / h …) 的 props 深层提取路径生效，
 * 详见 FRAMEWORK_ONLY_PROP_NAMES 的说明。
 *
 * @param key 对象属性名 (大小写不敏感，内部统一折叠为小写)
 */
export function isFrameworkOnlyPropName(key: string): boolean {
    const k = (key || '').toLowerCase();
    if (!k) return false;
    return FRAMEWORK_ONLY_PROP_NAMES.has(k);
}

/**
 * 全量判定：一级 ∪ 二级，即「一并视为不可译」的宽松口径。
 *
 * 仅用于测试与离线核查。生产路径请勿直接使用——isStructuralKey 必须区分上下文，
 * 否则二级名单会污染全局结构判定 (见 FRAMEWORK_ONLY_PROP_NAMES 的说明)。
 *
 * @param key 对象属性名 (大小写不敏感，内部统一折叠为小写)
 */
export function isNonTranslatablePropName(key: string): boolean {
    if (!key) return false;
    // 传原始 key：isMachineValuedPropName 需要大小写边界来做 aria 驼峰归一化，
    // 提前 toLowerCase 会抹掉边界导致 ariaHidden 之类整族漏网。
    return isMachineValuedPropName(key) || isFrameworkOnlyPropName(key);
}

// ============================================================================
// 3. Regex 提取相关配置
// ============================================================================

export const REGEX_DEFAULT_CONFIG = {
    /** 核心匹配正则表达式字符串 (支持转义引号) */
    patterns: [
        "(Notice|log|error|setText|setButtonText|setName|setDesc|setPlaceholder|setTooltip|appendText|setTitle|addHeading|renderMarkdown)\\(\\s*(['\"`])((?:[^\\\\2\\\\\\\\]|\\\\\\\\.)*?)\\2\\s*\\)",
        "(textContent|innerText|name|description|selection|annotation|link|text|search|speech|page|settings)\\s*[:=]\\s*(['\"`])((?:[^\\\\2\\\\\\\\]|\\\\\\\\.)*?)\\2"
    ],
    /** 默认排除正则字符串列表 (取自 SHARED_REJECT_RULES，与 AST 侧同源) */
    rejectPatterns: SHARED_REJECT_RULES.map(([pattern]) => pattern),
    /** 默认有效正则字符串列表 */
    validPatterns: [
        "\\s", "[^\\x00-\\x7F]", "[!?,;:。！？，；：]\\s*$"
    ]
};
