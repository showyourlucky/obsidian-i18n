import { Setting } from "obsidian"
import BaseSetting from "../base-setting"
import { t } from "src/locales";
import { attachCodeExample } from "./attach-code-example";


export default class I18nAST extends BaseSetting {
    main(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ==============================
        // 1. 提取上下文配置
        // ==============================
        new Setting(containerEl)
            .setName(t('Settings.Ast.ConfigHeader'))
            .setHeading()
            .addExtraButton(cb => cb
                .setIcon('rotate-ccw')
                .setTooltip(t('Settings.Basis.ResetGroupTooltip'))
                .onClick(async () => { await this.resetGroup(['astAssignments', 'astFunctions', 'astKeys', 'astOptionContainerKeys']); }));

        // 变量赋值白名单
        const assignSetting = new Setting(containerEl)
            .setName(t('Settings.Ast.AssignTitle'))
            .setDesc(t('Settings.Ast.AssignDesc'));
        attachCodeExample(assignSetting, t('Settings.Ast.AssignExample'), t('Settings.Ast.ExampleToggle'));
        this.addStackedTextArea(assignSetting, {
            initial: (this.settings.astAssignments || []).join('\n'),
            placeholder: t('Settings.Ast.AssignPlaceholder'),
            onChange: async (value) => {
                this.settings.astAssignments = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                await this.i18n.saveSettings();
            },
        });

        // 函数调用白名单
        const funcSetting = new Setting(containerEl)
            .setName(t('Settings.Ast.FuncTitle'))
            .setDesc(t('Settings.Ast.FuncDesc'));
        attachCodeExample(funcSetting, t('Settings.Ast.FuncExample'), t('Settings.Ast.ExampleToggle'));
        this.addStackedTextArea(funcSetting, {
            initial: (this.settings.astFunctions || []).join('\n'),
            placeholder: t('Settings.Ast.FuncPlaceholder'),
            onChange: async (value) => {
                this.settings.astFunctions = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                await this.i18n.saveSettings();
            },
        });


        // 对象键名白名单
        const keySetting = new Setting(containerEl)
            .setName(t('Settings.Ast.KeyTitle'))
            .setDesc(t('Settings.Ast.KeyDesc'));
        attachCodeExample(keySetting, t('Settings.Ast.KeyExample'), t('Settings.Ast.ExampleToggle'));
        this.addStackedTextArea(keySetting, {
            initial: (this.settings.astKeys || []).join('\n'),
            placeholder: t('Settings.Ast.KeyPlaceholder'),
            onChange: async (value) => {
                this.settings.astKeys = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                await this.i18n.saveSettings();
            },
        });


        // 选项容器键 (值是「子键 → 选项文案」映射对象，如 options / dropdownOptions)
        const optionContainerSetting = new Setting(containerEl)
            .setName(t('Settings.Ast.OptionContainerTitle'))
            .setDesc(t('Settings.Ast.OptionContainerDesc'));
        attachCodeExample(optionContainerSetting, t('Settings.Ast.OptionContainerExample'), t('Settings.Ast.ExampleToggle'));
        this.addStackedTextArea(optionContainerSetting, {
            initial: (this.settings.astOptionContainerKeys || []).join('\n'),
            placeholder: t('Settings.Ast.OptionContainerPlaceholder'),
            onChange: async (value) => {
                this.settings.astOptionContainerKeys = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                await this.i18n.saveSettings();
            },
        });


        // ==============================
        // 内容过滤规则 (正则)
        // ==============================
        new Setting(containerEl)
            .setName(t('Settings.Ast.RegexHeader'))
            .setHeading()
            .addExtraButton(cb => cb
                .setIcon('rotate-ccw')
                .setTooltip(t('Settings.Basis.ResetGroupTooltip'))
                .onClick(async () => { await this.resetGroup(['astRejectRe', 'astValidRe', 'astNonTranslatableProps', 'astTranslatableProps']); }));

        // 排除正则列表
        const rejectSetting = new Setting(containerEl)
            .setName(t('Settings.Ast.RejectReTitle'))
            .setDesc(t('Settings.Ast.RejectReDesc'));
        attachCodeExample(rejectSetting, t('Settings.Ast.RejectReExample'), t('Settings.Ast.ExampleToggle'));
        this.addStackedTextArea(rejectSetting, {
            initial: (this.settings.astRejectRe || []).join('\n'),
            placeholder: t('Settings.Ast.RejectPlaceholder'),
            onChange: async (value) => {
                this.settings.astRejectRe = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                await this.i18n.saveSettings();
            },
        });


        // 有效特征正则
        const validSetting = new Setting(containerEl)
            .setName(t('Settings.Ast.ValidReTitle'))
            .setDesc(t('Settings.Ast.ValidReDesc'));
        attachCodeExample(validSetting, t('Settings.Ast.ValidReExample'), t('Settings.Ast.ExampleToggle'));
        this.addStackedTextArea(validSetting, {
            initial: (this.settings.astValidRe || []).join('\n'),
            placeholder: t('Settings.Ast.ValidPlaceholder'),
            onChange: async (value) => {
                this.settings.astValidRe = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                await this.i18n.saveSettings();
            },
        });


        // 非可译属性名
        const nonTranslatableSetting = new Setting(containerEl)
            .setName(t('Settings.Ast.NonTranslatablePropsTitle'))
            .setDesc(t('Settings.Ast.NonTranslatablePropsDesc'));
        attachCodeExample(nonTranslatableSetting, t('Settings.Ast.NonTranslatablePropsExample'), t('Settings.Ast.ExampleToggle'));
        this.addStackedTextArea(nonTranslatableSetting, {
            initial: (this.settings.astNonTranslatableProps || []).join('\n'),
            placeholder: t('Settings.Ast.NonTranslatablePropsPlaceholder'),
            onChange: async (value) => {
                this.settings.astNonTranslatableProps = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                await this.i18n.saveSettings();
            },
        });


        // 例外属性名
        const translatableSetting = new Setting(containerEl)
            .setName(t('Settings.Ast.TranslatablePropsTitle'))
            .setDesc(t('Settings.Ast.TranslatablePropsDesc'));
        attachCodeExample(translatableSetting, t('Settings.Ast.TranslatablePropsExample'), t('Settings.Ast.ExampleToggle'));
        this.addStackedTextArea(translatableSetting, {
            initial: (this.settings.astTranslatableProps || []).join('\n'),
            placeholder: t('Settings.Ast.TranslatablePropsPlaceholder'),
            onChange: async (value) => {
                this.settings.astTranslatableProps = value.split('\n').map(s => s.trim()).filter(s => s !== '');
                await this.i18n.saveSettings();
            },
        });


        // ==============================
        // 翻译安全策略
        // ==============================
        new Setting(containerEl)
            .setName(t('Settings.Ast.SafetyHeader'))
            .setHeading()
            .addExtraButton(cb => cb
                .setIcon('rotate-ccw')
                .setTooltip(t('Settings.Basis.ResetGroupTooltip'))
                .onClick(async () => { await this.resetGroup(['astStrictMatch']); }));

        const strictSetting = new Setting(containerEl)
            .setName(t('Settings.Ast.StrictTitle'))
            .setDesc(t('Settings.Ast.StrictDesc'));
        attachCodeExample(strictSetting, t('Settings.Ast.StrictExample'), t('Settings.Ast.ExampleToggle'));
        strictSetting.addToggle(toggle => {
            toggle.setValue(!!this.settings.astStrictMatch)
                .onChange(async (value) => {
                    this.settings.astStrictMatch = value;
                    await this.i18n.saveSettings();
                });
        });

        // ==============================
        // 翻译提示词配置
        // ==============================
        new Setting(containerEl)
            .setName(t('Settings.Ast.PromptHeader'))
            .setHeading()
            .addExtraButton(cb => cb
                .setIcon('rotate-ccw')
                .setTooltip(t('Settings.Basis.ResetGroupTooltip'))
                .onClick(async () => { await this.resetGroup(['llmAstPrompt']); }));

        // AST Prompt 配置
        const astPromptSetting = new Setting(containerEl)
            .setName(t('Settings.Ast.PromptTitle'))
            .setDesc(t('Settings.Ast.PromptDesc'));

        // Prompt 内容通常较长，行数上限放宽到 30
        this.addStackedTextArea(astPromptSetting, {
            initial: this.settings.llmAstPrompt || '',
            placeholder: t('Settings.Ast.PromptPlaceholder'),
            minRows: 8,
            maxRows: 30,
            onChange: async (value) => {
                this.settings.llmAstPrompt = value;
                await this.i18n.saveSettings();
            },
        });
    }
}
