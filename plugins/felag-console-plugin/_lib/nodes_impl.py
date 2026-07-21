"""所有节点的业务逻辑纯函数。run.py 仅薄壳调用。每个 handle 接收
(params, conn, provider, actor)，写操作在本函数内落 audit 并 commit
（store 层不 commit，节点层收口事务）。"""
import psycopg2
from _lib import store, discover, db, official_catalog

class NodeError(Exception):
    pass

def _github_token() -> str:
    """从平台库读探测用 GitHub token(表 plg_felagplugin_config,key='github_token')。
    平台 worker 只给节点注入厳选 env(不转发 GITHUB_TOKEN),故 token 走节点已有的 DB 通道下发。
    读不到(表未建/未配/DB 不可达)一律回空 → discover 退回匿名,绝不因缺 token 让探测报错。"""
    try:
        conn = db.connect_platform()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT v FROM plg_felagplugin_config WHERE k = %s", ("github_token",))
                row = cur.fetchone()
                return (row[0] or "").strip() if row else ""
        finally:
            conn.close()
    except Exception:
        return ""

def handle_plugin_discover(params) -> dict:
    """探测 git 仓:先列所有分支(git smart-HTTP,不吃 REST 限流);传了 branch 再枚举该分支下插件。
    仅作建源提示,分支/插件名仍可手填。GitHub token(若已配)从平台库读、带认证下载防 codeload 429。"""
    git_url = (params.get("git_url") or "").strip()
    if not git_url:
        raise NodeError("git_url 必填")
    branch = (params.get("branch") or "").strip()
    token = _github_token()
    # 拆成两次独立节点调用,各吃一个 30s 节点预算,避免"列分支+枚举"叠在一次里顶穿截止:
    # 传了 branch → 只枚举该分支(分支列表已在无 branch 那次拿过);没传 → 只列分支。
    if branch:
        try:
            return {"plugins": discover.discover(git_url, branch, token=token)}
        except ValueError as e:      # 非 github / 无法解析:硬错,建源也走不通,照旧抛
            raise NodeError(str(e)) from e
        except Exception as e:       # 网络/超时/HTTP:枚举只是便利,插件名可手填 → 降级软提示,不打死节点
            return {"plugins": [], "plugins_error": f"枚举 {branch} 分支插件失败(仓库较大或网络慢,请手填插件名): {e}"}
    try:
        info = discover.list_branches(git_url, token=token)
    except ValueError as e:      # 非 github / 无法解析 owner-repo
        raise NodeError(str(e)) from e
    except Exception as e:       # 网络/HTTP(404 私有或不存在 / 429 限流)等
        raise NodeError(f"探测分支失败: {e}") from e
    return {"branches": info["branches"], "default_branch": info["default"]}

def handle_actor_context(params, conn, provider, actor) -> dict:
    scopes = provider.list_manageable_scopes(actor)
    return {
        "actor": {"user_id": actor.user_id, "name": actor.name, "dept_ref": actor.dept_ref},
        "manageable_scopes": [
            {"scope_ref": s.scope_ref, "label": s.label, "parent_ref": s.parent_ref} for s in scopes
        ],
    }

def handle_plugin_source_create(params, conn, provider, actor) -> dict:
    git_url = (params.get("git_url") or "").strip()
    plugin = (params.get("plugin") or "").strip()
    display_name = (params.get("display_name") or "").strip()  # 展示名,可空(空时下游回退用 plugin 包名)
    scope_ref = (params.get("scope_ref") or "").strip()
    branch = (params.get("branch") or "").strip() or "main"
    if not (git_url and plugin and scope_ref):
        raise NodeError("git_url / plugin / scope_ref 必填")
    if not provider.can_manage_scope(actor, scope_ref):   # 建：唯一信任 params.scope_ref（反查该 scope）
        raise NodeError("无权在该作用域建插件源")
    try:
        sid = store.create_source(conn, git_url, plugin, scope_ref, actor.user_id, branch=branch, display_name=display_name)
    except psycopg2.errors.UniqueViolation as e:
        conn.rollback()
        raise NodeError(f"插件源 (git,plugin,scope,branch) 已存在：{e}") from e
    store.add_audit(conn, actor.user_id, scope_ref, "source.create", f"source:{sid}",
                    {"git_url": git_url, "plugin": plugin, "display_name": display_name, "branch": branch})
    conn.commit()
    return {"id": sid}

def _load_owned(conn, provider, actor, source_id):
    row = store.get_source(conn, source_id)
    if row is None or not provider.can_manage_scope(actor, row["scope_ref"]):
        raise NodeError("插件源不存在或无权访问")   # 不暴露存在性
    return row

def handle_plugin_source_review(params, conn, provider, actor) -> dict:
    source_id = params.get("source_id")
    action = params.get("action")
    if action not in ("approve", "deprecate"):
        raise NodeError("action 必须是 approve / deprecate")
    row = _load_owned(conn, provider, actor, source_id)
    if action == "approve":
        ok = store.review_source(conn, source_id, actor.user_id)
    else:
        ok = store.deprecate_source(conn, source_id, actor.user_id)
    if not ok:
        conn.rollback()
        raise NodeError("插件源状态已变（非预期态 / 409），请刷新")
    store.add_audit(conn, actor.user_id, row["scope_ref"], f"source.{action}", f"source:{source_id}", {})
    conn.commit()
    return {"status": "approved" if action == "approve" else "deprecated"}

def handle_plugin_source_delete(params, conn, provider, actor) -> dict:
    source_id = params.get("source_id")
    row = _load_owned(conn, provider, actor, source_id)
    ok = store.delete_source(conn, source_id)
    if not ok:
        conn.rollback()
        raise NodeError("仅 draft / deprecated 插件源可删")
    store.add_audit(conn, actor.user_id, row["scope_ref"], "source.delete", f"source:{source_id}", {})
    conn.commit()
    return {"deleted": True}

def handle_plugin_source_rename(params, conn, provider, actor) -> dict:
    """只改展示名,其它列一律不动(scope 反查鉴权)。展示名可空(清空=回退用包名)。
    对 approved 源顺带置 sync_requested_at,让 felag-server 快轮询重摄、新名尽快下发到客户端。"""
    source_id = params.get("source_id")
    display_name = (params.get("display_name") or "").strip()
    row = _load_owned(conn, provider, actor, source_id)
    if not store.set_display_name(conn, source_id, display_name):
        conn.rollback()
        raise NodeError("插件源不存在,请刷新")
    synced = False
    if row["status"] == "approved":
        synced = store.request_sync(conn, source_id)  # 改名后触发快重摄,新名尽快下发
    store.add_audit(conn, actor.user_id, row["scope_ref"], "source.rename", f"source:{source_id}",
                    {"display_name": display_name})
    conn.commit()
    return {"display_name": display_name, "synced": synced}

def handle_plugin_source_sync(params, conn, provider, actor) -> dict:
    """请求立即同步:置该源 sync_requested_at=now(),felag-server 快轮询拾取后立即重摄。
    仅 approved 源;越权/非 approved → 拒。写审计。"""
    source_id = params.get("source_id")
    row = _load_owned(conn, provider, actor, source_id)
    if row["status"] != "approved":
        raise NodeError("仅 approved 插件源可请求同步")
    if not store.request_sync(conn, source_id):
        conn.rollback()
        raise NodeError("插件源状态已变(非 approved),请刷新")
    store.add_audit(conn, actor.user_id, row["scope_ref"], "source.sync_request", f"source:{source_id}", {})
    conn.commit()
    return {"sync_requested": True}

def handle_plugin_source_list(params, conn, provider, actor) -> dict:
    status = params.get("status")
    rows = store.list_sources_by_scopes(conn, provider.manageable_scope_refs(actor), status=status)
    # git_version 直接读列(由 felag-server 摄取 approved 源时写回,见 felag pluginsrc.Syncer)。
    # 不再在列表加载时逐行同步探 GitHub —— 那会让列表随源数线性变慢、且受 121→github 抖动/限流拖垮
    # (原实现单源最坏 12s、串行叠加顶穿节点 30s)。draft/未摄取源 git_version 为 NULL,前端展示 '—/待审核'。
    return {"sources": rows}

def handle_official_list(params, conn, provider, actor) -> dict:
    """列系统自带官方插件目录 + 每条在 actor 各可管 scope 下的启用态 + 凭据是否已配。
    catalog 是代码常量、只读;启停走 official_enable/disable。"""
    scope_refs = list(provider.manageable_scope_refs(actor))
    out = []
    for p in official_catalog.OFFICIAL_PLUGINS:
        enabled = store.official_enabled_scopes(conn, p["git_url"], p["plugin"], p["branch"], scope_refs)
        cfg = store.get_config(conn, p.get("cred_keys", []))
        creds_ok = all((cfg.get(k) or "").strip() for k in p.get("cred_keys", []))
        # 回显已配的非机密凭据值(app_id 一类)供编辑弹窗预填"知道老的";机密键(secret_keys)绝不回显。
        secret = set(p.get("secret_keys", []))
        cred_values = {k: (cfg.get(k) or "") for k in p.get("cred_keys", []) if k not in secret}
        out.append({
            "key": p["key"], "plugin": p["plugin"], "display_name": p["display_name"],
            "display_name_en": p.get("display_name_en", ""), "description": p.get("description", ""),
            "cred_keys": p.get("cred_keys", []), "creds_configured": creds_ok,
            "cred_values": cred_values,
            "enabled_scopes": sorted(enabled),
        })
    return {"plugins": out}


def _official_or_raise(plugin_key):
    p = official_catalog.get_official(plugin_key)
    if p is None:
        raise NodeError(f"未知官方插件: {plugin_key}")
    return p


def handle_official_enable(params, conn, provider, actor) -> dict:
    """启用某官方插件(某 scope):校验凭据已配 + scope 反查 → upsert kind='official' approved 源。
    felag-server 摄取切 mcp/ 子树 + 注入凭据 .env 下发。幂等。"""
    p = _official_or_raise(params.get("plugin_key"))
    scope_ref = (params.get("scope_ref") or "").strip()
    if not scope_ref:
        raise NodeError("scope_ref 必填")
    if not provider.can_manage_scope(actor, scope_ref):
        raise NodeError("无权在该作用域启用官方插件")
    # 凭据门禁:cred_keys 必须都在 KV 里且非空,否则 felag-server 会注入空 .env、client 登录失败。
    cfg = store.get_config(conn, p.get("cred_keys", []))
    missing = [k for k in p.get("cred_keys", []) if not (cfg.get(k) or "").strip()]
    if missing:
        raise NodeError(f"请先配置应用凭据: {', '.join(missing)}")
    sid = store.enable_official(conn, p["git_url"], p["plugin"], p["branch"], scope_ref, p["display_name"], actor.user_id)
    store.add_audit(conn, actor.user_id, scope_ref, "official.enable", f"source:{sid}",
                    {"plugin": p["plugin"]})
    conn.commit()
    return {"id": sid, "enabled": True}


def handle_official_disable(params, conn, provider, actor) -> dict:
    """停用某官方插件(某 scope):approved→deprecated,felag-server 卸载。scope 反查。"""
    p = _official_or_raise(params.get("plugin_key"))
    scope_ref = (params.get("scope_ref") or "").strip()
    if not provider.can_manage_scope(actor, scope_ref):
        raise NodeError("无权在该作用域停用官方插件")
    ok = store.disable_official(conn, p["git_url"], p["plugin"], p["branch"], scope_ref, actor.user_id)
    if not ok:
        conn.rollback()
        raise NodeError("该作用域未启用或状态已变,请刷新")
    store.add_audit(conn, actor.user_id, scope_ref, "official.disable", f"official:{p['plugin']}", {})
    conn.commit()
    return {"disabled": True}


def handle_official_set_creds(params, conn, provider, actor) -> dict:
    """配置某官方插件的应用凭据(写 plg_felagplugin_config KV,felag-server 摄取时注入包内 .env)。
    仅超管(不绑具体 scope,凭据是租户级)。凭据键限定在该插件 catalog 声明的 cred_keys,防越权写任意 KV。"""
    p = _official_or_raise(params.get("plugin_key"))
    if not getattr(actor, "is_superadmin", False):
        raise NodeError("仅超管可配置官方插件应用凭据")
    creds = params.get("creds") or {}
    allowed = set(p.get("cred_keys", []))
    written = []
    for k, v in creds.items():
        if k not in allowed:
            raise NodeError(f"非法凭据键: {k}")
        if (v or "").strip():
            store.set_config(conn, k, v.strip())
            written.append(k)
    store.add_audit(conn, actor.user_id, "*", "official.set_creds", f"official:{p['plugin']}",
                    {"keys": written})  # 只记键名,不记值
    conn.commit()
    return {"written": written}


def handle_audit_list(params, conn, provider, actor) -> dict:
    scopes = provider.manageable_scope_refs(actor)
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT actor, scope_ref, action, target, detail, ts FROM {store.P}audit "
            f"WHERE scope_ref = ANY(%s) ORDER BY id DESC LIMIT 200", (list(scopes),))
        keys = ["actor", "scope_ref", "action", "target", "detail", "ts"]
        rows = [store._jsonify(dict(zip(keys, r))) for r in cur.fetchall()]  # ts datetime→isoformat
    return {"audit": rows}
