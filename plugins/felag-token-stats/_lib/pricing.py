"""模型单价表 + 成本 SQL 生成。

## 为什么成本是这里算的,而不是直接读网关的 spend 列

网关三个模型的 `input_cost_per_token` / `output_cost_per_token` 全是 0(2026-08-24 查 `/model/info`
确认),所以 `LiteLLM_SpendLogs.spend` 恒为 0 —— 读它只会得到"一分钱没花"。而且就算现在去网关
配上单价,也**只对新请求生效**,已经攒下的历史请求永远是 0。故成本在本插件按 token 数 × 单价算,
口径透明可审,历史与新数据一视同仁。

## 三条必须知道的口径

1. **单位是人民币元**,不是美元 —— 官方定价表就是按元报的,不做汇率换算(汇率天天变,换算只会
   让数字更不可信)。UI 显示 ¥。
2. **不区分缓存命中**(用户 2026-08-24 拍板忽略)。DeepSeek 缓存命中价只有未命中的 1/30,
   而长上下文对话缓存命中率很高 —— 所以**这里算出来的成本是上限,真实账单会明显更低**。
3. **区分空闲/高峰时段**:高峰 = 北京时间**周一至周五 9:00-12:00、14:00-18:00**,其余(含周末
   全天)为空闲,单价减半。按请求发生的**本地时刻**逐条判定。

单价随官方调价而变;改这里的表即可,但**历史记录会跟着按新价重算** —— 本表没有生效日期维度,
要按当时价核账单请另存价格版本。
"""
from __future__ import annotations

# 高峰价,单位:元 / 百万 token。空闲时段自动减半。
# 来源:DeepSeek 官方定价表(2026-08-24 用户提供)。输入按**缓存未命中**价,见上文口径 2。
PEAK_PRICE_PER_MTOK = {
    "deepseek-v4-pro": (9.0, 27.0),
    "deepseek-v4-flash": (3.0, 9.0),
    "deepseek-v4-flash-vision-exp": (3.0, 9.0),
    # 智谱免费档,不计费。
    "glm-4.6v-flash": (0.0, 0.0),
}

# 网关上的模型别名 → 真正计费的模型。deepseek-chat 是官方 2026-07-24 停用的老名,
# 网关把它重指到 v4-flash 承接老客户端,计费也得按 v4-flash。
ALIASES = {
    "deepseek-chat": "deepseek-v4-flash",
}

# spend log 里的 model 形如 "deepseek/deepseek-v4-pro",去掉 provider 前缀再匹配。
_BARE_MODEL = "regexp_replace(model, '^.*/', '')"

# 高峰时段判定:本地时刻落在周一至周五的 9:00-12:00 或 14:00-18:00。
# 边界取左闭右开 —— 12:00 整、18:00 整算空闲。
_PEAK_FACTOR = (
    "CASE WHEN extract(isodow from {ts}) <= 5"
    " AND ((({ts})::time >= '09:00' AND ({ts})::time < '12:00')"
    "   OR (({ts})::time >= '14:00' AND ({ts})::time < '18:00'))"
    " THEN 1.0 ELSE 0.5 END"
)


def _price_case(idx: int) -> str:
    """按模型给出高峰单价(元/token)。idx=0 取输入价,1 取输出价。
    表里没有的模型 → 0,并且在 UI 上会体现为"这个模型没配价",不会假装成免费。"""
    whens = []
    for name, price in PEAK_PRICE_PER_MTOK.items():
        whens.append(f"WHEN '{name}' THEN {price[idx] / 1e6:.12g}")
    for alias, target in ALIASES.items():
        whens.append(f"WHEN '{alias}' THEN {PEAK_PRICE_PER_MTOK[target][idx] / 1e6:.12g}")
    return f"CASE {_BARE_MODEL} {' '.join(whens)} ELSE 0 END"


def cost_expr(local_ts_sql: str) -> str:
    """单条请求的成本表达式(元)。local_ts_sql 是该行的本地时刻表达式。

    单价常量全部由本文件的字典生成,不含任何外部输入 —— 拼进 SQL 是安全的。"""
    factor = _PEAK_FACTOR.format(ts=local_ts_sql)
    return (f"((prompt_tokens * {_price_case(0)}) + (completion_tokens * {_price_case(1)})) * {factor}")


def peak_flag_expr(local_ts_sql: str) -> str:
    """该行是否落在高峰时段(明细页标出来 —— 同样的 token 数,高峰是空闲的两倍钱)。"""
    return f"({_PEAK_FACTOR.format(ts=local_ts_sql)}) = 1.0"


def priced_models() -> list[str]:
    """已配价的模型名(含别名),给 UI 提示哪些模型的成本是有效的。"""
    return sorted(set(PEAK_PRICE_PER_MTOK) | set(ALIASES))
