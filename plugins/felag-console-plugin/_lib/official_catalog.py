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
    },
    {
        "key": "felag-vision",
        "plugin": "felag-vision",
        "git_url": "https://github.com/bestfunc/felag-console.git",
        "branch": "main",
        "display_name": "图片视频识别",
        "display_name_en": "Image & Video Understanding",
        "description": "数字员工可以看图和看视频：描述内容、转录图中文字、概括视频。"
                       "识别经 felag-server 转网关，上游密钥不下发到客户端；识别用哪个模型在「模型与密钥」页设置。",
        # 🔒 这里**不含任何 LLM key** —— 识图用的上游密钥必须留在网关(M5),
        # 绝不像飞书那样注入包内下发。felag_vision_token 只是"能敲 felag-server 的门"的
        # 服务令牌,且由 server 自举写进本表、摄取时自动注入 —— **管理员一个字都不用填**,
        # 打开「配置凭据」会看到它已是已配状态。
        "cred_keys": ["felag_vision_token"],
        "secret_keys": ["felag_vision_token"],
    },
]

_BY_KEY = {p["key"]: p for p in OFFICIAL_PLUGINS}


def get_official(key):
    """按 key 取官方插件定义;不存在 → None。"""
    return _BY_KEY.get(key)
