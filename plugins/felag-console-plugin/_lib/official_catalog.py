"""系统自带「官方插件」目录(catalog)——代码常量、不可编辑。
管理员按组织 scope 启用/停用;启用 = create+approve 一条 kind='official' 源(指向官方插件仓),
felag-server 摄取切 mcp/<plugin>/ 子树 + 注入凭据 .env 下发到 client。
后续加官方插件 = 往本列表追加一条,无 schema 改动。"""

# 每条官方插件:
#   key          catalog 内唯一键(前端用)
#   plugin       插件包名(= 官方仓 mcp/<plugin>/,felag-server 摄取硬校验 == plugin.json.name)
#   git_url      官方插件仓(felag-server 从此摄取;私有仓走 FELAG_GITHUB_TOKEN)
#   branch       分支
#   display_name 展示名(下发到 client 连接器卡)
#   cred_keys    该插件需要的 plg_felagplugin_config KV 键(启用前必须已配,felag-server 注入包内 .env)
OFFICIAL_PLUGINS = [
    {
        "key": "feishu-mail",
        "plugin": "feishu-mail",
        "git_url": "https://github.com/bestfunc/felag-console.git",
        "branch": "dev",
        "display_name": "飞书邮件",
        "display_name_en": "Feishu Mail",
        "description": "用户登录飞书后，数字员工可读取其飞书邮箱邮件。",
        "cred_keys": ["lark_app_id", "lark_app_secret"],
    },
]

_BY_KEY = {p["key"]: p for p in OFFICIAL_PLUGINS}


def get_official(key):
    """按 key 取官方插件定义;不存在 → None。"""
    return _BY_KEY.get(key)
