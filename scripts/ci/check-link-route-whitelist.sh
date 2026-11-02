#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# check-link-route-whitelist.sh — V2026-09-14 长期方案 Stage C CI 校验.
#
# 校验 src/practice/constants/allowed-link-routes.ts 跟前端
#   lib/core/network/link_route_validator.dart 的白名单是否 1:1 同步.
#
# 设计 (大厂 CI standard):
#   - 静默路径白名单 grep 抽两端字符串, sort -u 后 diff
#   - 静态模板 (RegExp) 数量对齐 (本期 8 条, 改时同时改两端 + 数量)
#   - 9 source enum 数量 (后端 TOOL_COMPLETION_SOURCES / 前端 mapper enum 1:1)
#   - 数量不对等就 fail-fast, 不打 warning (CI 必须 fail, 不能静默)
#   - 跨平台: pure bash + grep + find, 不依赖 jq / python / docker
#
# 调用:
#   ./scripts/ci/check-link-route-whitelist.sh                        # 本地手动跑 (auto-detect)
#   FRONTEND_DIR=/path/to/xin_su_app ./scripts/ci/check-link-route-whitelist.sh  # 显式指定前端
#
# 退出码:
#   0 - 完全一致
#   1 - 静态 path 数量不一致
#   2 - 静态 path 字符串有 diff
#   3 - 动态模板数量不一致
#   4 - 9 source enum 数量不对
# ════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_TS="$SCRIPT_DIR/../../src/practice/constants/allowed-link-routes.ts"

# V2026-09-14 治本: mofang-nestjs 是独立 git repo, 不能假设上层 Project 根.
#   显式 FRONTEND_DIR 环境变量优先, 否则 /mnt 下 find 自动定位.
#   注: /mnt 在 WSL2 是 9P mount, find /mnt 扫描很慢 (分钟级), CI 推荐显式 FRONTEND_DIR.
if [[ -n "${FRONTEND_DIR:-}" ]]; then
  FRONTEND_DART="$FRONTEND_DIR/lib/core/network/link_route_validator.dart"
  FRONTEND_DART_TOOL_COMPLETION="$FRONTEND_DIR/lib/features/practice/domain/utils/tool_completion_source_mapper.dart"
else
  # 限制 /mnt 扫描深度避免扫到盘根 — 默认 maxdepth 6 (足够覆盖 frontend/xin_su_app/lib/)
  FRONTEND_DART="$(find /mnt -maxdepth 6 -type f -name 'link_route_validator.dart' -path '*core/network*' 2>/dev/null | head -1 || true)"
  FRONTEND_DART_TOOL_COMPLETION="$(find /mnt -maxdepth 8 -type f -name 'tool_completion_source_mapper.dart' -path '*practice/domain/utils*' 2>/dev/null | head -1 || true)"
fi

# ─── 路径存在性 ───
if [[ ! -f "$BACKEND_TS" ]]; then
  echo "❌ 后端白名单文件不存在: $BACKEND_TS" >&2
  exit 1
fi
if [[ -z "$FRONTEND_DART" ]] || [[ ! -f "$FRONTEND_DART" ]]; then
  echo "❌ 前端白名单文件找不到." >&2
  echo "   在 /mnt 下未找到 link_route_validator.dart" >&2
  echo "   请检查前端项目路径, 期望: frontend/xin_su_app/lib/core/network/link_route_validator.dart" >&2
  echo "   或者用环境变量 FRONTEND_DIR=/path/to/xin_su_app 显式指定 (推荐, CI 上必须设)" >&2
  exit 1
fi

echo "═══ 检查 linkRoute 白名单 1:1 同步 ═══"
echo "  后端: $BACKEND_TS"
echo "  前端: $FRONTEND_DART"
echo ""

# ─── 静态 path 抽取 ───
# V2026-09-14 治本: 抽「白名单数组」(Set<...> / const [...] 等) 块内容,
#   排除注释行 (// ...), 然后再 grep 路径字符串. 这样 /tools/ghost /tools/self-esteem
#   这类「仅出现在注释里的反例路径」不会被误算.
#   注: 后端 TS 数组写法 new Set<string>([...]) / const X = [...], 前端 dart const set / const list,
#   都是「数组字面」形式, awk 大括号配对抽取最稳.
extract_whitelist() {
  local file="$1"
  # awk: 找到第一个 [ 或 { 开始, 累计括号深度, 找到对应 ] / } 结束.
  # 同时跳过 // 单行注释 (Python/TS 不支持跨行注释, 这里够用).
  awk '
    BEGIN { depth = 0; in_block = 0 }
    {
      line = $0
      # 删 // 注释
      sub(/\/\/.*$/, "", line)
      if (in_block == 0 && (line ~ /\[[ \t]*$/ || line ~ /\{[ \t]*$/)) {
        in_block = 1
        depth = 1
        next
      }
      if (in_block == 1) {
        n = gsub(/\[/, "[", line)
        n += gsub(/\]/, "]", line)
        depth += n
        if (depth <= 0) in_block = 0
        print
      }
    }
  ' "$file" | grep -oE "'[/][^']*'" | grep -v ':' | sort -u
}

BACKEND_EXACT=$(extract_whitelist "$BACKEND_TS")
FRONTEND_EXACT=$(extract_whitelist "$FRONTEND_DART")

BACKEND_COUNT=$(echo "$BACKEND_EXACT" | wc -l | tr -d ' ')
FRONTEND_COUNT=$(echo "$FRONTEND_EXACT" | wc -l | tr -d ' ')

echo "── 静态 path 数量 ──"
echo "  后端: $BACKEND_COUNT"
echo "  前端: $FRONTEND_COUNT"

if [[ "$BACKEND_COUNT" != "$FRONTEND_COUNT" ]]; then
  echo ""
  echo "❌ 静态 path 数量不一致!"
  echo "   后端 $BACKEND_COUNT ≠ 前端 $FRONTEND_COUNT"
  echo ""
  echo "   反双胞胎: 加新 AutoRoute 必须两端同步, 改任一端必须改另一端."
  exit 1
fi

# ─── 静态 path diff (0 期望) ───
DIFF=$(diff <(echo "$BACKEND_EXACT") <(echo "$FRONTEND_EXACT") || true)
if [[ -n "$DIFF" ]]; then
  echo ""
  echo "❌ 静态 path 字符串有 diff:"
  echo "$DIFF"
  echo ""
  echo "   反双胞胎: 后端 src/practice/constants/allowed-link-routes.ts 跟"
  echo "   前端 lib/core/network/link_route_validator.dart 的 staticPaths 必须"
  echo "   字符级 1:1 同步. 改任一端必须改另一端, 否则启动期 fail-fast."
  exit 2
fi

# ─── 动态模板 数量校验 (本期 8 条) ───
BACKEND_TEMPLATES=$(grep -oE "/\\^\\\\/[a-zA-Z0-9-]+\\\\/[^/]+\\\\/[^/]+\\\$/" "$BACKEND_TS" | wc -l | tr -d ' ')
FRONTEND_TEMPLATES=$(grep -oE "RegExp\(r'\\^/[a-zA-Z0-9-]+/\\[\\^/\\]+/\\$" "$FRONTEND_DART" | wc -l | tr -d ' ')

echo ""
echo "── 动态模板数量 ──"
echo "  后端: $BACKEND_TEMPLATES"
echo "  前端: $FRONTEND_TEMPLATES"

if [[ "$BACKEND_TEMPLATES" != "$FRONTEND_TEMPLATES" ]]; then
  echo ""
  echo "❌ 动态模板数量不一致!"
  echo "   后端 $BACKEND_TEMPLATES ≠ 前端 $FRONTEND_TEMPLATES"
  echo ""
  echo "   V2026-09-14 长期方案 Stage C: 9 source / 47 静态 path / 8 动态模板,"
  echo "   加新路由必须两端同步 (参见 docs/architecture/growth-api-contract.md §6)."
  exit 3
fi

# ─── 9 source enum 数量 (TOOL_COMPLETION_SOURCES / 前端 mapper enum) ───
BACKEND_SOURCES=$(grep -oE "'breathing_[a-z]+'|'thought_[a-z]+'|'breathing_[a-z]+'|'emotion_[a-z]+'|'cbt_[a-z]+'|'act_[a-z]+'|'self_[a-z]+'|'interpersonal'|'advanced_[a-z]+'" "$BACKEND_TS" | sort -u | wc -l | tr -d ' ')

# 前端: 从 mapper 文件 grep 9 个 enum value (格式 ToolCompletionSource.xxx('wire'))
FRONTEND_SOURCES=0
if [[ -n "$FRONTEND_DART_TOOL_COMPLETION" ]] && [[ -f "$FRONTEND_DART_TOOL_COMPLETION" ]]; then
  FRONTEND_SOURCES=$(grep -oE "ToolCompletionSource\.[a-zA-Z]+\('[a-z_]+'\)" "$FRONTEND_DART_TOOL_COMPLETION" | wc -l | tr -d ' ')
fi

echo ""
echo "── 9 source enum 数量 (TOOL_COMPLETION_SOURCES / ToolCompletionSource) ──"
echo "  后端: $BACKEND_SOURCES (期望 9)"
echo "  前端: $FRONTEND_SOURCES (期望 9)"

if [[ "$BACKEND_SOURCES" != "9" ]] || [[ "$FRONTEND_SOURCES" != "9" ]]; then
  echo ""
  echo "❌ 9 source enum 数量不对!"
  echo "   后端: $BACKEND_SOURCES (期望 9)"
  echo "   前端: $FRONTEND_SOURCES (期望 9)"
  echo ""
  echo "   V2026-09-14 长期方案 Stage C: 9 source 跟前端 mapper 1:1 严格契约."
  exit 4
fi

echo ""
echo "✅ linkRoute 白名单 + 9 source enum 全部 1:1 同步"
echo "   静态 path: $BACKEND_COUNT 条"
echo "   动态模板: $BACKEND_TEMPLATES 条"
echo "   9 source: $BACKEND_SOURCES / $FRONTEND_SOURCES (前后端一致)"
exit 0
