import { Injectable } from '@nestjs/common';

/**
 * 模板参数.
 *
 * V2026-11-05 治本 (WP45 · P3-2): 原来是 `type TemplateParameter = any[]` + 一条
 *   `eslint-disable @typescript-eslint/no-explicit-any` —— 裸 `any` 意味着这个类型
 *   **对类型系统隐形**: 调用方传任何东西都不报错, 而 `template` 内部把参数
 *   **插值进模板字符串**, 非字符串的值会被隐式转成 "[object Object]" 之类.
 *   错在哪一步没人看得见 (这与 `qdrant.service.ts` 的 `client: any` 是同一类债:
 *   **用 `any` 关掉的那盏灯, 正是出事故时照不到的那盏**).
 *
 * 现在收窄成 `unknown[]`: 调用方传什么都要先想清楚, 而"怎么把参数变成字符串"
 *   由 `stringifyTemplateValue` **一处**定义 —— 不再散落在模板字面量的隐式转换里.
 *
 * ⚠️ 为什么是 `unknown[]` 而不是 `string[]`:
 *   模板参数天然是**任意值** (数字、布尔、null 都有意义); 强写成 `string[]`
 *   会逼调用方到处 `String(...)`, 那是把转换成本推给调用方.
 */
type TemplateParameter = unknown[];

/**
 * 把一个模板参数转成字符串 (唯一的转换口径).
 *
 * ⚠️ 为什么用显式 `String(...)` 而不是模板字面量插值 `${value}`:
 *   插值遇到 **symbol** 会抛 `TypeError` (模板字面量不允许 symbol), 而
 *   `String(symbol)` 正常返回 "Symbol(x)" —— 显式转换把那颗雷拆掉.
 *
 * ⚠️ 为什么不用 `JSON.stringify`:
 *   那会**改变**非字符串参数的可读结果 (对象从 "[object Object]" 变成 JSON 文本) ——
 *   那是行为变更, 不该在清技术债时顺手做. 本单只把"隐式"变成"显式", 不改结果.
 *
 * @param value 模板参数 (任意值)
 * @returns 字符串形式
 */
function stringifyTemplateValue(value: unknown): string {
  // ⚠️ 字符串原样返回 (最快路径, 也是最常见的情况).
  if (typeof value === 'string') return value;
  return String(value);
}

@Injectable()
export class UtilService {
  public template(templateData: TemplateStringsArray, param: TemplateParameter, delimiter = '\n'): string {
    let output = '';
    for (const [i, element] of param.entries()) {
      output += `${templateData[i]}${stringifyTemplateValue(element)}`;
    }
    output += templateData[param.length];

    const lines: string[] = output.split(/(?:\r\n|\n|\r)/);

    return lines
      .map((text: string) => text.replaceAll(/^\s+/gm, ''))
      .join(delimiter)
      .trim();
  }

  public pre(templateData: TemplateStringsArray, ...param: TemplateParameter): string {
    return this.template(templateData, param, '\n');
  }

  public line(templateData: TemplateStringsArray, ...param: TemplateParameter): string {
    return this.template(templateData, param, ' ');
  }

  public removeUndefined(argv: object): Record<string, unknown> {
    // https://stackoverflow.com/questions/25421233
    // JSON.parse(JSON.stringify(args));
    return Object.fromEntries(Object.entries(argv).filter(([, value]: [string, unknown]) => value !== undefined));
  }
}
