import I18N from 'src/main';
import { I18nSettingTab } from '.';
import { I18nSettings, DEFAULT_SETTINGS } from './data';
import { App, Notice, Setting } from 'obsidian';
import { t } from 'src/locales';

export default abstract class BaseSetting {
    protected settingTab: I18nSettingTab;
    protected i18n: I18N;
    protected settings: I18nSettings;
    public containerEl: HTMLElement;
    protected a: HTMLElement;
    protected app: App;

    constructor(obj: I18nSettingTab) {
        this.settingTab = obj;
        this.i18n = obj.i18n;
        this.settings = obj.i18n.settings;
        this.a = obj.containerEl;
        this.containerEl = obj.contentEl;
        this.app = obj.app;
    }

    public abstract main(): void;
    public display(): void { this.main() }

    /**
     * 将指定字段恢复为出厂默认值（覆盖语义）。
     * 供分组标题右侧的 ↺ 按钮调用：重置某一组规则配置。
     * 范围由调用方控制（仅规则配置，不含 API Key / 翻译数据）。
     */
    protected async resetGroup(fields: Array<keyof I18nSettings>): Promise<void> {
        if (!window.confirm(t('Settings.Basis.ResetGroupConfirm'))) return;
        const defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as I18nSettings;
        const target = this.settings as unknown as Record<string, unknown>;
        const source = defaults as unknown as Record<string, unknown>;
        for (const f of fields) {
            target[f] = source[f];
        }
        await this.i18n.saveSettings();
        new Notice(t('Settings.Basis.ResetGroupSuccess'));
        this.settingTab.display();
    }
    /**
     * 给 Setting 追加「堆叠布局」的多行文本域
     *
     * 规则类设置项的描述很长 (还带折叠示例块)，Obsidian 默认的
     * 「左信息 + 右控件」横向布局会把文本域挤得又窄又矮。此方法：
     * 1. 给 .setting-item 打上 i18n-setting-stacked 标记，
     *    配合 styles.css 让描述独占一行、文本域另起一行吃满整行；
     * 2. rows 按当前内容行数计算 (min ~ max)，内容增删后跟随增减，
     *    避免「两行内容配了六行高度」或反之的矮/空旷观感。
     *
     * @param setting 目标 Setting 实例
     * @param opts.initial 初始文本 (多行用 \n 拼接)
     * @param opts.placeholder 占位提示
     * @param opts.onChange 内容变更回调
     * @param opts.minRows 最小行数，默认 3
     * @param opts.maxRows 最大行数，默认 20
     */
    protected addStackedTextArea(
        setting: Setting,
        opts: {
            initial: string;
            placeholder: string;
            onChange: (value: string) => void | Promise<void>;
            minRows?: number;
            maxRows?: number;
        },
    ): void {
        const minRows = opts.minRows ?? 3;
        const maxRows = opts.maxRows ?? 20;

        // 堆叠布局标记：CSS 据此把该设置项改为纵向排列
        setting.settingEl.addClass('i18n-setting-stacked');

        setting.addTextArea(text => {
            const input = text.inputEl;

            // 按内容行数计算高度：空内容按 1 行算，再夹在 min ~ max 之间
            const applyRows = () => {
                const lines = input.value ? input.value.split('\n').length : 1;
                input.rows = Math.min(maxRows, Math.max(minRows, lines));
            };

            text.setValue(opts.initial)
                .setPlaceholder(opts.placeholder)
                .onChange(async (value) => {
                    // 高度跟随当前内容，再交还业务回调保存设置
                    applyRows();
                    await opts.onChange(value);
                });

            applyRows(); // 初次渲染即按内容定高
        });
    }
}
