import I18N from 'src/main';
import { I18nSettingTab } from '.';
import { I18nSettings, DEFAULT_SETTINGS } from './data';
import { App, Notice } from 'obsidian';
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
}
