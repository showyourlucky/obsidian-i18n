import React, { useEffect, useState, useCallback } from 'react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    Tabs, TabsList, TabsTrigger, TabsContent,
    Button, Label, Textarea
} from '~/shadcn';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PluginExtractRules, PluginExtractRuleCall } from '../../../../types';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    pluginId: string;
    /** 当前已保存的插件专属规则 (打开弹窗时回填) */
    initialRules: PluginExtractRules | null;
    /** 保存回调：rules 为空对象/全空时由调用方视为清除；返回 false 时保留弹窗 */
    onSave: (rules: PluginExtractRules | null) => boolean;
}

/** 多行文本字段定义：label + 说明 */
interface FieldDef {
    key: string;
    label: string;
    desc?: string;
    placeholder?: string;
    mono?: boolean;
}

const AST_FIELDS: FieldDef[] = [
    { key: 'keys', label: '键名白名单 (astKeys)', desc: '对象属性键名，如 part1 / itemName', mono: true },
    { key: 'assignments', label: '赋值白名单 (astAssignments)', desc: '变量赋值左侧名，如 x.desc = "..."', mono: true },
    { key: 'functions', label: '函数白名单 (astFunctions)', desc: '仅框架 create* 系调用；自封装函数请用调用规则', mono: true },
    { key: 'optionContainers', label: '选项容器键 (astOptionContainerKeys)', desc: '值是「子键→文案」映射对象，如 description', mono: true },
    {
        key: 'callRules', label: '调用规则 (callRules)', desc: '每行一条：fn 或 fn:0,2 (参数位缺省 0)。用于自封装函数，如 tr("...")',
        placeholder: 'tr\nformatMessage:1', mono: true,
    },
    { key: 'nonTranslatableProps', label: '非可译属性名', desc: '强制视为机器取值的键名', mono: true },
    { key: 'translatableProps', label: '例外属性名', desc: '解除内置黑名单的键名', mono: true },
    { key: 'rejectRe', label: '排除正则 (astRejectRe)', desc: '命中则不提取，每行一条', mono: true },
    { key: 'validRe', label: '有效正则 (astValidRe)', desc: '命中则放行提取，每行一条', mono: true },
];

const REGEX_FIELDS: FieldDef[] = [
    { key: 'patterns', label: '正则提取规则 (reDatas)', desc: '每行一条，捕获组 1 为原文', mono: true },
    { key: 'rejectRe', label: '排除正则 (reRejectRe)', desc: '命中则不提取，每行一条', mono: true },
    { key: 'validRe', label: '有效正则 (reValidRe)', desc: '命中则放行提取，每行一条', mono: true },
];

const linesToArr = (text: string): string[] =>
    text.split('\n').map(s => s.trim()).filter(s => s !== '');

const parseCallRules = (text: string): PluginExtractRuleCall[] => {
    const rules: PluginExtractRuleCall[] = [];
    for (const line of linesToArr(text)) {
        const commentIdx = line.indexOf('//');
        const body = commentIdx >= 0 ? line.slice(0, commentIdx).trim() : line;
        if (!body) continue;
        const sepIdx = body.indexOf(':');
        const fn = (sepIdx >= 0 ? body.slice(0, sepIdx) : body).trim();
        if (!fn) continue;
        const args = sepIdx >= 0
            ? body.slice(sepIdx + 1).split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n >= 0)
            : undefined;
        rules.push({ fn, args: args && args.length > 0 ? args : undefined });
    }
    return rules;
};

const formatCallRules = (rules: PluginExtractRuleCall[] | undefined): string =>
    (rules ?? []).map(r => (r.args && r.args.length > 0 ? `${r.fn}:${r.args.join(',')}` : r.fn)).join('\n');

/** 插件专属提取规则编辑弹窗 (AST / Regex 两栏，与全局设置字段一一对应) */
const PluginRulesDialog: React.FC<Props> = ({ open, onOpenChange, pluginId, initialRules, onSave }) => {
    const { t } = useTranslation();
    const [astText, setAstText] = useState<Record<string, string>>({});
    const [reText, setReText] = useState<Record<string, string>>({});
    const [formError, setFormError] = useState('');

    // 每次打开时从已保存规则回填 (以打开瞬间为准，编辑中不与外部同步)
    useEffect(() => {
        if (!open) return;
        const ast = initialRules?.ast ?? {};
        const regex = initialRules?.regex ?? {};
        const nextAst: Record<string, string> = {};
        for (const f of AST_FIELDS) {
            nextAst[f.key] = f.key === 'callRules'
                ? formatCallRules(ast.callRules)
                : (ast as any)[f.key]?.join('\n') ?? '';
        }
        const nextRe: Record<string, string> = {};
        for (const f of REGEX_FIELDS) {
            nextRe[f.key] = (regex as any)[f.key]?.join('\n') ?? '';
        }
        setAstText(nextAst);
        setReText(nextRe);
        setFormError('');
    }, [open, initialRules]);

    const handleSave = useCallback(() => {
        for (const f of REGEX_FIELDS) {
            for (const pattern of linesToArr(reText[f.key] ?? '')) {
                try {
                    new RegExp(pattern);
                } catch {
                    setFormError(t('Editor.Errors.InvalidRegex', {
                        field: f.label,
                        pattern,
                        defaultValue: `${f.label} 中存在非法正则：${pattern}`,
                    }));
                    return;
                }
            }
        }
        setFormError('');

        const ast: PluginExtractRules['ast'] = {};
        for (const f of AST_FIELDS) {
            const arr = f.key === 'callRules' ? parseCallRules(astText[f.key] ?? '') : linesToArr(astText[f.key] ?? '');
            if (arr.length > 0) (ast as any)[f.key] = arr;
        }
        const regex: PluginExtractRules['regex'] = {};
        for (const f of REGEX_FIELDS) {
            const arr = linesToArr(reText[f.key] ?? '');
            if (arr.length > 0) (regex as any)[f.key] = arr;
        }
        const isEmpty = Object.keys(ast).length === 0 && Object.keys(regex).length === 0;
        const saved = onSave(isEmpty ? null : { ast, regex });
        if (saved) onOpenChange(false);
    }, [astText, reText, onSave, onOpenChange, t]);

    const renderField = (f: FieldDef, text: Record<string, string>, setText: React.Dispatch<React.SetStateAction<Record<string, string>>>) => (
        <div key={f.key} className="flex flex-col gap-1">
            <Label className="text-xs font-medium text-foreground/80">{f.label}</Label>
            {f.desc && <span className="text-[10px] leading-tight text-muted-foreground">{f.desc}</span>}
            <Textarea
                value={text[f.key] ?? ''}
                onChange={(e) => setText(prev => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder ?? t('Common.Placeholders.LinePerRule', '每行一条')}
                // 高度用 min/max 双夹紧而非 h-16：shadcn 的 field-sizing-content 会按内容
                // 撑高文本框 (h-16 压不住)，多行内容把滚动区下滚、顶部字段被顶出视野；
                // 规范保证 field-sizing: content 的内容尺寸会被 max-* 硬性截断，
                // min=max=4rem 后无论哪个 field-sizing 生效，高度恒定，超出部分框内滚动
                className={`field-sizing-fixed min-h-16 max-h-16 w-full min-w-0 resize-y bg-background text-xs ${f.mono ? 'font-mono' : ''}`}
            />
        </div>
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-sm">
                        <SlidersHorizontal className="w-4 h-4" />
                        {t('Editor.Dialogs.PluginRulesTitle', '本插件专属提取规则')}
                    </DialogTitle>
                </DialogHeader>
                <div className="text-[11px] leading-relaxed text-muted-foreground">
                    {t('Editor.Dialogs.PluginRulesDesc', '仅对当前插件生效，与全局白名单取并集追加；规则清空后已提取的条目会保留在翻译文件中。')}
                    <span className="block mt-0.5 font-mono text-[10px]">pluginId: {pluginId}</span>
                </div>
                <Tabs defaultValue="ast" className="flex min-h-0 flex-1 flex-col gap-2">
                    <TabsList className="h-8 w-full grid grid-cols-2 bg-muted/50 p-1 shrink-0">
                        <TabsTrigger className="text-xs" value="ast">AST</TabsTrigger>
                        <TabsTrigger className="text-xs" value="regex">Regex</TabsTrigger>
                    </TabsList>
                    {/* TabsContent 必须收敛高度 (min-h-0 + overflow-hidden)：flex 子项默认
                        min-height:auto 会随内容撑开，把滚动区顶出弹窗裁剪区导致无法滚动。
                        不用 Radix ScrollArea：其视口内层是 display:table;min-width:100%，
                        table 会随长行内容撑宽，w-full 的文本框跟着被拉伸——原生滚动容器
                        (block 布局) 子项宽度恒等于容器，长内容只会换行/出纵向滚动条 */}
                    <TabsContent value="ast" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
                        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-2">
                            <div className="flex flex-col gap-3 pb-1">
                                {AST_FIELDS.map(f => renderField(f, astText, setAstText))}
                            </div>
                        </div>
                    </TabsContent>
                    <TabsContent value="regex" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
                        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-2">
                            <div className="flex flex-col gap-3 pb-1">
                                {REGEX_FIELDS.map(f => renderField(f, reText, setReText))}
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
                {formError && (
                    <div role="alert" className="text-xs text-destructive break-all">
                        {formError}
                    </div>
                )}
                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
                        {t('Common.Actions.Cancel', '取消')}
                    </Button>
                    <Button variant="default" size="sm" className="h-8 text-xs" onClick={handleSave}>
                        {t('Common.Actions.Save', '保存')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export { PluginRulesDialog };
