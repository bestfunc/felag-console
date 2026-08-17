# felag-vision —— 图片 / 视频识别 MCP 插件

数字员工可以「看」图和视频:描述内容、转录图中文字、概括视频。

## 与 feishu-mail 的关键差别:凭据不下发

feishu-mail 的 LARK 凭据随签名包下发到 client 是可以的——它不是 LLM key。
**识图用的 GLM key 是 LLM key,下发就破 M5**(LLM key 永不出 Server)。所以本插件
不直连智谱,只持一个访问 `felag-server /vision/describe` 的服务令牌:

```
数字员工 → 本插件 --服务令牌--> felag-server --master key--> LiteLLM → GLM
                                    ↑ 上游 key 只到这里为止
```

## 路径安全(这不是体验问题,是数据外泄面)

client 对 `mcp__*` 工具是**自动放行不弹审批**的。不加限制的话,数字员工可以
`describe_image("C:/私密文档.png")` 把任意文件内容送到外部模型。

因此本地文件只允许读 `FELAG_VISION_ROOTS` 指定的根(client 注入:会话工作区 +
用户显式拖入的只读引用),并用 `realpath` 归一——否则工作区里放一个指向 `C:\` 的
symlink/junction 就能绕出去。**未注入该变量时 fail-closed:只接受 `url`,不读本地文件。**

## 注入的环境变量

| 变量 | 来源 | 说明 |
|---|---|---|
| `FELAG_SERVER_BASE` | client | 用户登录的 felag-server 地址(server 自己不知道对外地址) |
| `FELAG_VISION_TOKEN` | felag-server 摄取时注入包内 `.env` | 服务令牌,由 server 自举写平台库,**用户不用填** |
| `FELAG_VISION_ROOTS` | client | 允许读取的根目录,`os.pathsep` 分隔 |

## 工具

- `describe_image(path? | url?, question?, model?)`
- `describe_video(path? | url?, question?, model?)`

`model` 可直接指定识别模型;不给则用平台「模型与密钥」页设为**使用中**的识图模型
(`role_vision`),再退到服务端内置默认。

## 上游约束(121 实测,写进工具描述里让模型知道)

- 智谱免费档**同时只能处理 1 个请求**,多张图必须**串行**,并发必然整片 429
- 有 **5 小时滚动配额**,短时间狂刷会限流(不扣费),等配额恢复即可
- 服务端已做串行 + 退避重试(总时长收在 MCP 的 60s 超时内),插件侧 50s 主动超时并给可读提示
- 视频单次可达 **7 万 token**,比图片贵得多;过大的视频请先截片段
- ⚠️ 图片太小(如 2×2)会被判「图片输入格式/解析错误」——测试时别用极小图

## 构建

改了 `server/` **必须重建 dist**,否则改动完全不生效:

```bash
cd server && npm install
npx esbuild index.mjs --bundle --platform=node --format=esm --outfile=../dist/felag-vision.mjs
```

`git add` 要带上 `dist/felag-vision.mjs`(运行时是它,`server/` 只是源码)。
