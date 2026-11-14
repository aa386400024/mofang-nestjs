// V2026-11-14 治本 (TD-15 · C+ 枚举外移 · P-DEBT-11 / L-1):
//   第三方登录 provider 枚举 —— 从 `entities/oauth-identity.entity.ts` 外移.
//
//   治本:
//     - 枚举原先定义在 entity 文件里, 任何**值位置**导入它的代码 (oauth.service /
//       oauth.controller) 都会把 entity 文件拉进模块加载期 → 顶层 @Entity / @Column
//       / @ManyToOne 装饰器求值 → typeorm 经**传递**闭包进入.
//       移到零 typeorm 依赖的独立文件后, 这条边即解除.
//     - 本文件**零** typeorm / @nestjs/typeorm 依赖, 不引用任何 entity 类,
//       无装饰器 / 无 Nest / 无 process.env / 无网络 —— 纯枚举定义.
//     - 枚举成员名与字符串值**逐字不变** (业务语义零漂移).
//
//   反双胞胎:
//     - 不复用别的域的 provider 枚举 —— 本枚举只描述第三方登录渠道,
//       与 AI provider (llm/common/enums) 不是一回事, 混用会把两个维度焊死.
//
//   如何验证:
//     1. tsc 0 错; 全量测试用例数与既有断言逐字不变;
//     2. grep 复核: 本文件 typeorm import = 0; 原 `entities/` 路径下的枚举 import 残留 = 0.
//
//   时间戳: 2026-11-14 GMT+8

/**
 * OAuth provider enum — 第三方登录 provider 枚举.
 */
export enum OAuthProvider {
  Wechat = 'wechat',
  Google = 'google',
  Apple = 'apple',
}
