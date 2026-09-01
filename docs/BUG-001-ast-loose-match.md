# BUG-001: AST 翻译器宽松匹配回退导致插件崩溃

| 项 | 值 |
|---|---|
| 编号 | BUG-001 |
| 严重级别 | **P0 — 阻断**（目标插件完全无法加载） |
| 状态 | **已修复**（方案 A + 方案 B；方案 C 另行排期） |
| 影响版本 | `2.0.21`（`main` 分支 `d2426e4`） |
| 修复版本 | `2.0.21`（待发布） |
| 缺陷文件 | `src/utils/translator/core-ast-translator.ts` |
| 缺陷方法 | `AstTranslator.translate()`（L86-120）、`traverseAllStrings()`（L379-421） |
| 关联缺陷 | `core-regex-translator.ts` `translate()`（L236-244）同类问题，见 §6 |
| 报告日期 | 2026-09-02 |

---

## 1. 缺陷概述

`AstTranslator.translate()` 在严格匹配（`type:name:source` 指纹）失败时，**无条件回退为"仅按 source 文本"匹配**。该回退完全丢弃 AST 上下文，导致：

> 翻译包中任意一条 `source`，会替换**目标插件代码中所有文本相同的字符串字面量**，无论该字符串在代码中扮演的是 UI 文案、枚举值、对象键、分支判断还是模块系统内部标识。

用户在翻译编辑器中看到的是 `ObjectProperty / label / "default"`，会合理认为只改这一个 label。实际受影响的是插件内全部 106 处 `"default"` 字面量，其中包含 esbuild 的 `__toESM` 互操作辅助函数 —— 直接导致 React 模块导出被破坏，插件加载即崩溃。

**关键判定：这是实现缺陷，不是用户误操作。** 因为即使翻译的完全是无可争议的 UI 文案（如按钮文字 `"Cancel"`），只要该文本在代码其他位置承担逻辑职责（如 `err.message.startsWith("Cancel")`），崩溃或功能异常照样发生。用户无法从 UI 上察觉这一点。

---

## 2. 复现

### 环境

- Obsidian 桌面版，i18n `2.0.21`
- 目标插件：Copilot `4.0.4`（React 18.2.0 + jotai，esbuild bundle 5.3 MB）

### 步骤

1. 对 Copilot 执行「提取」→ 得到 1209 条候选（ast 815 + regex 394）
2. 汉化其中 773 条，包含条目 `{ type: "ObjectProperty", name: "label", source: "default", target: "默认" }`
3. 应用翻译

### 期望

仅 `label: "default"` 这一处 UI 文案变为「默认」。

### 实际

Obsidian 控制台报错，Copilot 加载失败：

```
Plugin failure: copilot TypeError: Cannot read properties of undefined (reading 'use')
    at eval (plugin:copilot:80:30275)
    at eval (plugin:copilot:80:30843)
    at eval (plugin:copilot:80:49854)
    at eval (plugin:copilot:92:612)
    at eval (plugin:copilot:3260:722)
```

---

## 3. 根因分析

### 3.1 缺陷代码

`src/utils/translator/core-ast-translator.ts` L86-120：

```ts
public translate(ast: t.Node, translations: PluginTranslationV1Ast[]): string {
    const strictMap = new Map<string, string>(); // type:name:source -> target
    const looseMap = new Map<string, string>();  // source -> target (fallback)

    translations.forEach(item => {
        if (item.type && item.name) {
            strictMap.set(this.getFingerprint(item), item.target);
        }
        looseMap.set(item.source, item.target);   // ← ① 每条都无条件进宽松表
    });

    this.traverseAllStrings(ast, (type, name, valueNode) => {
        const source = this.extractSource(valueNode);
        if (!source) return;

        let target = strictMap.get(this.getFingerprint({ type, name, source } as any));
        if (!target) {
            target = looseMap.get(source);        // ← ② 缺陷核心：无条件回退
        }

        if (target && target !== source) {
            this.replaceSource(valueNode, target);
        }
    });

    return generate(ast, { minified: true, comments: false, jsescOption: { minimal: true } }).code;
}
```

`getFingerprint` = `` `${type}:${name}:${source}` ``

### 3.2 为什么回退几乎必然触发

`extract()` 用 `traverseWhitelist()`，**只**在白名单上下文采集；`translate()` 用 `traverseAllStrings()`，遍历**全部**字符串节点。二者产出的 `(type, name)` 并不对等：

- **提取阶段**：`ObjectProperty` 的键必须是白名单 `keys` 之一（如 `label`、`title`），才产出 `{type:"ObjectProperty", name:"label", source:"default"}`
- **翻译阶段**：任何对象的任何字符串值都被访问，键名是什么无所谓

于是对同一份压缩后的 bundle：

| 阶段 | `type:name` | 指纹 |
|---|---|---|
| 提取 | `ObjectProperty:label` | `ObjectProperty:label:default` |
| 翻译（遍历到 `__toESM` 内部） | `CallExpression:z5` | `CallExpression:z5:default` |

**指纹必然不同 → 严格匹配必然失败 → 必然走回退 → 必然误替换。**

这不是边缘情况。压缩代码里短标识符（`z5`、`L`、`n`、`t`）大量重复，严格匹配的命中率极低，回退路径才是实际上的主路径。翻译包里的 `type` / `name` 字段因此形同虚设。

### 3.3 崩溃链路

Copilot bundle 中 esbuild 生成的 `__toESM`（`main.js` L35）：

```js
var L = (t, e, n) => (
    n = t != null ? pPn(gPn(t)) : {},
    Rct(
        e || !t || !t.__esModule
            ? z5(n, "default", { value: t, enumerable: !0 })   // ← 受害者
            : n,
        t
    )
);
```

`z5` 即 `Object.defineProperty`。处理流程：

1. `traverseAllStrings` 访问到 `z5(n, "default", {...})` 的第二个实参
   → `getCallName(z5)` = `"z5"` → 上报 `("CallExpression", "z5", StringLiteral("default"))`
2. 严格指纹 `CallExpression:z5:default` 在 `strictMap` 中不存在
3. 回退：`looseMap.get("default")` → 命中 → `target = "默认"`
4. `replaceSource` 把字面量改写为 `z5(n, "默认", {...})`
5. `__toESM` 从此把模块导出挂到 **`默认`** 属性而非 `default`

jotai 的 React 适配层（`main.js` L114）：

```js
wut = b(() => {
    "use client";
    Zd = L(B(), 1);                    // B() = React CJS 模块工厂
    ...
    QPn = Zd.default.use || (t => {...})   // ← 报错点，对应堆栈 80:30275
});
```

`Zd.default` 已不存在（现在是 `Zd.默认`）→ 读取 `.use` → `Cannot read properties of undefined`。

> 注：受影响的是 `"default"` **字符串字面量**（106 处），不是 `.default` 属性访问语法。后者是 `MemberExpression` 的属性名，不经过本翻译器。

### 3.4 同类破坏（`"default"` 的其余受害者）

| 位置 | 原文 | 翻译后后果 |
|---|---|---|
| `__toESM` | `z5(n,"default",{value:t})` | **React 崩溃（本次 P0）** |
| 模块互操作 | `"default" in wue.default ? wue.default.default : wue.default` | 导出解析全部错乱 |
| 时区枚举 | `gAn=["default","plan","auto"]` | 分支判断永不命中 |
| CSS 值表 | `cursor:["auto","default",...]` | 样式失效 |
| zod schema | `{type:"default",innerType:e}` | 默认值校验失效 |

---

## 4. 影响面量化

对 Copilot 4.0.4 翻译包（773 条已翻译）全量扫描的结果：

| 分类 | 数量 | 说明 |
|---|---|---|
| 安全 | 565 | 全代码仅 1 处，或多处但角色一致 |
| **危险** | **155** | 同文本在代码中有 >1 处出现 |
| **必须还原** | **13** | 存在参与程序逻辑的用法 |
| 失效 | 37 | 源码中已找不到（版本漂移） |

### 13 条确凿的逻辑污染条目

判据：该 `source` 在代码中参与了 `startsWith`／`includes`／`===`／`switch case`／对象键 等程序逻辑。

| source | target | 逻辑用法 | 翻译后的实际后果 |
|---|---|---|---|
| `default` | 默认 | 作为属性名被 `defineProperty` 写入 | **React 崩溃（本次）** |
| `Cancel` | 取消 | `err.message.startsWith("Cancel")` ×2 | 取消操作的异常识别失效 |
| `Delete` | 删除 | `n.key === "Delete"` | **Delete 键失灵** |
| `Edit` | 编辑 | `case "Edit": case "MultiEdit":` | switch 分支不可达 |
| `Web` | 网页 | `S === "web" ? "Web" : ...` | 搜索类型判定错乱 |
| `Folders` | 文件夹 | `S === "folders" ? "Folders" : ...` | 同上 |
| `Tags` | 标签 | `S === "tags" ? "Tags" : ...` | 同上 |
| `Properties` | 属性 | `S === "properties" ? "Properties" : ...` | 同上 |
| `Ignore Files` | 忽略文件 | `S === "ignoreFiles" ? "Ignore Files" : ...` | 同上 |
| `Recency` | 最近使用 | `r.source === "time-filtered" ? "Recency" : "Relevance"` | 排序标签与状态脱钩 |
| `Select Model` | 选择模型 | `i !== "Select Model" && save(...)` | 每次选择都触发保存 |
| `Open Copilot Agent Chat` | 打开… | `addRibbonIcon(..., u ? "Open Copilot Agent Chat" : "Open Copilot Chat", ...)` | 图标 tooltip 与状态位混淆 |

另需还原的硬编码依赖词：`default`（3651 处 `.default` 访问）、`value`（1254）、`string`（772）。

### 为何用户无法规避

翻译编辑器只呈现 `type` / `name` / `source`，不提示该字符串在代码其他位置承担的职责。用户没有途径得知 `"Delete"` 同时是键盘按键名。**这是设计缺陷，不是操作失误。**

---

## 5. 修复方案

### 方案 A：上下文安全校验（推荐，最小侵入）

**思路**：不改变双表结构，在回退命中前加一道「该字符串字面量是否参与程序逻辑」的检查。参与则跳过。

在 `core-ast-translator.ts` 新增方法：

```ts
/**
 * 判断字符串节点是否参与程序逻辑 (不可翻译)
 * 参与逻辑的字符串翻译后会导致判断/比较/分支失效
 */
private isLogicString(path: any): boolean {
    const { parentPath, parent, node } = path;

    // 1. 字符串方法调用: x.startsWith("abc") / x.includes("abc")
    if (t.isCallExpression(parent) && parent.arguments.includes(node)) {
        const callee = parent.callee;
        let methodName: string | null = null;
        if (t.isIdentifier(callee)) methodName = callee.name;
        else if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
            methodName = callee.property.name;
        }
        if (methodName && LOGIC_STRING_METHODS.has(methodName)) return true;
    }

    // 2. 二元比较: x === "abc" / "abc" === x
    if (t.isBinaryExpression(parent)) {
        if (['===', '!==', '==', '!='].includes(parent.operator)) return true;
    }

    // 3. switch case 分支值
    if (t.isSwitchCase(parent) && parent.test === node) return true;

    // 4. 对象键 (计算属性除外)
    if (t.isObjectProperty(parent) && parent.key === node && !parent.computed) return true;

    // 5. 硬编码依赖词 (模块互操作 / 语言关键字)
    if (typeof node.value === 'string' && HARDCODED_WORDS.has(node.value)) return true;

    return false;
}
```

配套常量（置于 `config.ts`）：

```ts
/** 参与逻辑判断的字符串方法 */
export const LOGIC_STRING_METHODS = new Set([
    'startsWith', 'endsWith', 'includes', 'indexOf', 'lastIndexOf',
    'match', 'test', 'search', 'localeCompare', 'replace', 'split'
]);

/** 翻译后会破坏语言/模块机制的词 */
export const HARDCODED_WORDS = new Set([
    'default', 'value', 'string', 'module', 'exports', 'require',
    'client', 'strict', 'production', 'development', 'constructor',
    'prototype', 'toString', 'valueOf'
]);
```

改造 `traverseAllStrings`，把 `path` 传给回调（当前只传 `type/name/node`）：

```ts
private traverseAllStrings(
    ast: t.Node,
    callback: (type: string, name: string, valueNode: t.StringLiteral | t.TemplateLiteral, safe: boolean) => void
) {
    const visit = (path: any, type: string, name: string) => { /* 现有逻辑 */ };
    // ...
    VariableDeclarator: (path) => {
        const node = path.node;
        const name = t.isIdentifier(node.id) ? node.id.name : 'var';
        if (this.isStrNode(node.init)) {
            callback('VariableDeclarator', name, node.init, !this.isLogicString(path.get('init')));
        }
    },
    // ObjectProperty / CallExpression / NewExpression / AssignmentExpression 同理
}
```

`translate()` 中消费该标志：

```ts
this.traverseAllStrings(ast, (type, name, valueNode, safe) => {
    const source = this.extractSource(valueNode);
    if (!source) return;

    let target = strictMap.get(this.getFingerprint({ type, name, source } as any));

    // 严格匹配失败时，仅当该字符串不参与程序逻辑才允许回退
    if (!target && safe) {
        target = looseMap.get(source);
    }

    if (target && target !== source) {
        this.replaceSource(valueNode, target);
    }
});
```

同步修改 `traceUsage()`（L126-155），让冗余诊断与实际翻译口径一致。

**影响**：`replace` / `split` 列入 `LOGIC_STRING_METHODS` 会略微减少可翻译条目（如 `Notice(text.replace(...))`），但这两者以字符串变量为参数时本就不应翻译，宁可保守。

---

### 方案 B：严格模式开关（治标，建议与 A 并行）

为 `translate()` 增加 `options.strict` 参数，并在设置面板暴露开关。开启时禁用 `looseMap` 回退：

```ts
public translate(
    ast: t.Node,
    translations: PluginTranslationV1Ast[],
    options: { strict?: boolean } = {}
): string {
    // ...
    if (!target && !options.strict) {
        target = looseMap.get(source);
    }
    // ...
}
```

调用点（`plugin-item.tsx` L198、`editor.tsx` L472）从 `i18n.settings` 读取。

**权衡**：严格模式依赖指纹准确。由于 §3.2 所述提取/遍历上下文不对等，即使开启，命中率也会明显下降（部分原本"碰巧生效"的翻译消失）。因此**不能单独作为修复**，应与方案 A 配合 —— A 负责消除误伤，B 给用户一个更保守的兜底选项。

---

### 方案 C：指纹增强（中长期，可选）

在提取阶段额外记录**结构上下文**以提升严格匹配命中率，例如祖先链上的函数名、或 `source` 在文件内的出现序号：

```ts
// 示例：把出现序号纳入指纹
private getFingerprint(item: { type: string, name: string, source: string, occurrence?: number }) {
    return `${item.type}:${item.name}:${item.source}:${item.occurrence ?? 0}`;
}
```

**风险**：引入 `occurrence` 会让翻译包对目标插件的代码改动极度敏感 —— 插件升级后序号漂移，翻译大面积失效。当前 37 条"失效条目"已经暴露了版本漂移问题，此方案会放大它。若采用，须配套「序号失效时回退到非序号指纹」的兼容逻辑。**不建议在 P0 修复中引入。**

---

### 推荐落地顺序

1. **方案 A** —— 消除误伤，解决 P0
2. **方案 B** —— 提供保守开关，作为额外保险
3. 方案 C 另行排期讨论

---

## 6. 关联缺陷：`RegexTranslator` 同类问题

`src/utils/translator/core-regex-translator.ts` L236-244：

```ts
public translate(code: string, translations: PluginTranslationV1Regex[]): string {
    let translatedCode = code;
    for (const item of translations) {
        if (item.source && item.target && item.source !== item.target) {
            translatedCode = translatedCode.split(item.source).join(item.target);  // ← 全局无差别替换
        }
    }
    return translatedCode;
}
```

问题更严重：**纯文本全局替换，连引号边界都不校验**。若 `source` 为 `default`（无引号），会连 `.default` 属性访问、标识符中的 `default` 一并替换，直接产出语法错误。

本次事故中 Copilot 的 regex 组全部未翻译（0/394），故未触发。但风险客观存在，建议一并处理：

```ts
public translate(code: string, translations: PluginTranslationV1Regex[]): string {
    let translatedCode = code;
    for (const item of translations) {
        if (!item.source || !item.target || item.source === item.target) continue;

        // 仅在 source 自带引号边界时视为安全替换，否则要求目标代码以引号包裹
        const escaped = item.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const quoteNames = /^\s*["'`]/.test(item.source)
            ? new RegExp(escaped, 'g')
            : new RegExp(`(["'\`])${escaped}\\1`, 'g');

        translatedCode = translatedCode.replace(quoteNames, (m) => m); // 占位：见下方实现说明
    }
    return translatedCode;
}
```

**实现说明**：应改为「捕获引号并以 `引号 + target + 引号` 回填」，确保替换始终发生在字符串字面量边界内；对无引号的 `source` 一律拒绝替换并记入诊断。建议单独开 issue 跟踪，不阻塞 BUG-001。

---

## 7. 验证方法

### 7.1 单元测试（建议补充至 `src/utils/translator/__tests__/`）

项目当前**无任何测试文件**（`*.test.ts` 搜索结果为空），建议同步建立。关键用例：

```ts
describe('AstTranslator.translate 上下文安全', () => {
    const cases: { name: string; code: string; item: any; expectUntouched: boolean }[] = [
        {
            name: '不应替换 defineProperty 的属性名',
            code: `Object.defineProperty(n, "default", { value: t });`,
            item: { type: 'ObjectProperty', name: 'label', source: 'default', target: '默认' },
            expectUntouched: true,
        },
        {
            name: '不应替换 startsWith 的判断参数',
            code: `if (msg.startsWith("Cancel")) {}`,
            item: { type: 'ObjectProperty', name: 'text', source: 'Cancel', target: '取消' },
            expectUntouched: true,
        },
        {
            name: '不应替换全等比较的右值',
            code: `if (e.key === "Delete") {}`,
            item: { type: 'ObjectProperty', name: 'label', source: 'Delete', target: '删除' },
            expectUntouched: true,
        },
        {
            name: '不应替换 switch case 分支值',
            code: `switch (x) { case "Edit": break; }`,
            item: { type: 'ObjectProperty', name: 'label', source: 'Edit', target: '编辑' },
            expectUntouched: true,
        },
        {
            name: '不应替换对象键',
            code: `const m = { "Web": 1 };`,
            item: { type: 'ObjectProperty', name: 'label', source: 'Web', target: '网页' },
            expectUntouched: true,
        },
        {
            name: '应正常翻译 UI 文案',
            code: `showModal({ label: "Delete" });`,
            item: { type: 'ObjectProperty', name: 'label', source: 'Delete', target: '删除' },
            expectUntouched: false,
        },
    ];

    cases.forEach(({ name, code, item, expectUntouched }) => {
        it(name, () => {
            const translator = new AstTranslator({} as any);
            const ast = translator.loadCode(code)!;
            const out = translator.translate(ast, [item]);
            expect(out.includes(item.target)).toBe(!expectUntouched);
        });
    });
});
```

### 7.2 集成验证

1. `npm run build` → 产物覆盖 `.obsidian/plugins/i18n/main.js`
2. 还原 Copilot 翻译包至修复前状态（备份 `*.bak2.json`），确认含 `"default" → "默认"` 等 13 条
3. 应用翻译 → 重启 Obsidian
4. **期望**：Copilot 正常加载，无 `Cannot read properties of undefined` 报错
5. 跑 `ob-classify.cjs` 复验：必须还原项应为 0

### 7.3 回归检查

修复后重跑扫描脚本，逐项确认：

- 必须还原条目：13 → **0**
- 汉化覆盖率：不应显著下降（预期 707/757 ≈ 93%，剩余均为纯展示文案）

---

## 8. 附：本次用于定位的脚本

置于 `.obsidian/plugins/i18n/`，可直接复用：

| 脚本 | 用途 |
|---|---|
| `ob-classify.cjs` | 按「是否参与程序逻辑」分类翻译条目，输出必须还原清单 |
| `ob-fix.cjs` | 按分类结果自动还原（临时缓解，非源码修复） |
| `ob-risk.cjs` | 按字面量出现次数统计连带替换风险 |
| `ob-locate.cjs` | 报错行列 → 附件代码（自动处理 eval 造成的行偏移） |

用法：

```powershell
node "E:\笔记\.obsidian\plugins\i18n\ob-classify.cjs"
```

---

## 9. 时间线

| 时间 | 事件 |
|---|---|
| 2026-09-01 | 首次报告 Copilot 汉化后崩溃，定位到 `Zd.default.use` |
| 2026-09-01 | 确认报错点位于 jotai React 适配层，React 模块工厂 `B()` 返回值失效 |
| 2026-09-01 | 通过逐条替换模拟锁定 `ast #434 "default" → "默认"` |
| 2026-09-01 | 还原 16 条硬编码依赖词（`default`/`value`/`string` 等） |
| 2026-09-02 | 反编译 i18n 产物，提取 `translate()` 实现，确认宽松回退为根因 |
| 2026-09-02 | 全量扫描确认 13 条逻辑污染条目，全部还原 |
| 2026-09-02 | 拉取源码 `F:\nodejs\obsidian-i18n`（`d2426e4`），定位至 `core-ast-translator.ts` L86-120，输出本文档 |
