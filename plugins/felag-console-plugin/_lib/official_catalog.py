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
#   secret_keys  cred_keys 里属机密的键(app_secret 一类):official_list 不回显其值、只回非密钥(app_id)供预填
#   config_ui    这颗"配置"按钮该弹什么:
#                  "creds"        —— 应用凭据表单(飞书那套 App ID / Secret)
#                  "vision_model" —— 识图模型下拉(该插件唯一要人决定的事;凭据是自举的,没什么可填)
#                  "none"         —— 无需配置,不显示按钮
OFFICIAL_PLUGINS = [
    {
        "key": "feishu-mail",
        "plugin": "feishu-mail",
        "git_url": "https://github.com/bestfunc/felag-console.git",
        "branch": "main",
        "display_name": "飞书邮件",
        "display_name_en": "Feishu Mail",
        "description": "用户登录飞书后，数字员工可读写其飞书邮箱：查/搜/读邮件与附件链接、标已读打标签、发送/回复/转发。",
        "cred_keys": ["lark_app_id", "lark_app_secret"],
        "secret_keys": ["lark_app_secret"],
        "config_ui": "creds",
    },
    {
        "key": "felag-vision",
        "plugin": "felag-vision",
        "git_url": "https://github.com/bestfunc/felag-console.git",
        "branch": "main",
        "display_name": "图片视频识别",
        "display_name_en": "Image & Video Understanding",
        "description": "数字员工可以看图和看视频：描述内容、转录图中文字、概括视频。"
                       "识别经 felag-server 转网关，上游密钥不下发到客户端。",
        # 🔒 这里**不含任何 LLM key** —— 识图用的上游密钥必须留在网关(M5),
        # 绝不像飞书那样注入包内下发。felag_vision_token 只是"能敲 felag-server 的门"的
        # 服务令牌,且由 server 自举写进本表、摄取时自动注入 —— **管理员一个字都不用填**。
        "cred_keys": ["felag_vision_token"],
        "secret_keys": ["felag_vision_token"],
        # 凭据既然是自举的,那颗按钮就不该弹一张没东西可填的表单。
        # 这个插件真正要人决定的只有一件事:用哪个模型看图(写的就是 role_vision,
        # 与「模型与密钥」页的「图片识别」同一个值,不是第二个真相源)。
        "config_ui": "vision_model",
    },
]

_BY_KEY = {p["key"]: p for p in OFFICIAL_PLUGINS}


def get_official(key):
    """按 key 取官方插件定义;不存在 → None。"""
    return _BY_KEY.get(key)
