/**
 * 设置页「提取规则示例」折叠组件
 *
 * 每条提取规则 (赋值属性 / 函数参数 / 对象键名 / 选项容器键 / 排除正则 ...) 的语义
 * 仅凭一句话描述很难说清源码长什么样，此处以折叠的代码示例补充说明：
 * - 默认收起 (details/summary)，不撑爆设置页，想看才展开；
 * - 示例文本来自 locale (settings.ts)，与其它文案同源维护；
 * - 约定格式为「// ✅ 会被捕获 ... / // ❌ 不会捕获 ...」两段式注释标记。
 */
import { Setting } from 'obsidian';

/**
 * 在 Setting 的描述区下方追加一个可折叠的代码示例块
 *
 * @param setting 目标 Setting 实例 (示例插到其描述元素内)
 * @param exampleText 示例源码文本 (来自 locale，支持多行)
 * @param toggleText 折叠开关文字，缺省为「查看示例」
 */
export function attachCodeExample(setting: Setting, exampleText: string, toggleText: string = '查看示例'): void {
    if (!exampleText || !exampleText.trim()) return;

    // Setting 的 descEl 是描述容器，示例块追加在描述文字之后
    const details = setting.descEl.createEl('details', { cls: 'i18n-rule-example' });
    details.createEl('summary', { text: toggleText });
    const pre = details.createEl('pre');
    pre.createEl('code', { text: exampleText });
}
