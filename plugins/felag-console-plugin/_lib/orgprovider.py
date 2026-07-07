"""纯组织（部门/岗位）provider。**PlatformOrgProvider 读平台真实 org**
(departments/positions, 迁移 000017) 为生产实现，业务节点走它；StubOrgProvider 是
无 DB 的内存桩，仅供本地单测注入。两者接口同构，run.py 换类即可、节点逻辑不动。
**不读 users/roles/permissions、无 is_super、无权限门**——可管范围 = 调用者所在部门
子树（坐公司根部门 = 管全树）。见 spec §3。"""
from __future__ import annotations
import os
from dataclasses import dataclass

@dataclass
class Actor:
    user_id: str          # 平台 users.id（仅 created_by/审计归属）
    name: str
    dept_ref: "str | None"  # 调用者所在部门 scope_ref（None = 未分配 → 可管空）

@dataclass
class ScopeNode:
    scope_ref: str
    label: str
    parent_ref: "str | None"

# ---- fixture 组织树（stub）：scope_ref 格式 <type>:<code>，与平台 dept:<id>/pos:<id> 形态同构 ----
_TREE = {
    "branch:sh":   ScopeNode("branch:sh",   "上海分公司",   None),      # is_company 根
    "dept:ops":    ScopeNode("dept:ops",    "运维部",       "branch:sh"),
    "pos:ops-eng": ScopeNode("pos:ops-eng", "运维工程师",   "dept:ops"),
    "pos:ops-lead":ScopeNode("pos:ops-lead","运维负责人",   "dept:ops"),
    "dept:impl":   ScopeNode("dept:impl",   "实施部",       "branch:sh"),
    "pos:impl-eng":ScopeNode("pos:impl-eng","实施工程师",   "dept:impl"),
}
# 用户 → 所在部门（纯组织，无 is_super / 无 grant）
_USERS = {
    "u_root": {"name": "总部管理员", "dept_ref": "branch:sh"},   # 坐根 → 子树=全树
    "u_ops":  {"name": "运维",       "dept_ref": "dept:ops"},
    "u_impl": {"name": "实施",       "dept_ref": "dept:impl"},
    "u_none": {"name": "未分配",     "dept_ref": None},
}

def _subtree(root: str) -> set:
    out, stack = set(), [root]
    while stack:
        cur = stack.pop()
        out.add(cur)
        stack.extend(n.scope_ref for n in _TREE.values() if n.parent_ref == cur)
    return out

class StubOrgProvider:
    def __init__(self, actor_id: "str | None" = None):
        self._actor_id = actor_id or os.environ.get("FELAG_CONSOLE_STUB_ACTOR", "u_root")

    def get_actor(self, task) -> Actor:
        u = _USERS.get(self._actor_id) or _USERS["u_none"]
        return Actor(user_id=self._actor_id, name=u["name"], dept_ref=u["dept_ref"])

    def can_manage_scope(self, actor: Actor, scope_ref: str) -> bool:
        return scope_ref in self.manageable_scope_refs(actor)

    def manageable_scope_refs(self, actor: Actor) -> set:
        if not actor.dept_ref:
            return set()
        return _subtree(actor.dept_ref)

    def list_manageable_scopes(self, actor: Actor):
        return [_TREE[r] for r in sorted(self.manageable_scope_refs(actor))]

class PlatformOrgProvider:
    """读平台真实 org（departments/positions，迁移 000017）。可管范围 = 当前 rt.dept 的
    递归子树；坐公司根部门(is_company)时子树自然=全树，无需特判。**无 is_super 特判、不读
    users/roles/permissions**（spec §3 纯组织；granted_perms 平台 omitempty 不注入）。
    cron / API Key / 匿名 → identity/dept 为 None → fail-closed（dept_ref=None → 可管空）。
    **例外：is_superadmin=true → 无视部门返回全公司 org 树**（2026-07-02 用户拍板的逃生口，
    刻意偏离 spec §3；超管常是不挂部门的系统账号，否则永远可管为空）。

    get_actor 一次性把子树从 DB 拉齐并缓存（run.py 里 get_actor 先于 handler 执行、provider
    实例贯穿整个请求）；其余方法读缓存。scope_ref 格式 dept:<id> / pos:<id>。"""

    def __init__(self, conn):
        self._conn = conn
        self._refs: set = set()      # 可管 scope_ref 集
        self._nodes: list = []       # list[ScopeNode]（部门 + 岗位）

    def get_actor(self, identity) -> Actor:
        ident = identity or {}
        dept = ident.get("dept")
        user = ident.get("user") or {}
        uid = user.get("id")
        actor = Actor(
            user_id=str(uid) if uid is not None else "",
            name=user.get("display_name") or user.get("username") or "",
            dept_ref=f"dept:{dept['id']}" if dept else None,
        )
        # 超管逃生口（2026-07-02 用户拍板，刻意偏离 spec §3 的「无 is_super」）：平台超管
        # 常是不挂部门的系统账号(rt.dept=None)，纯组织规则下可管为空 → 无法管理任何 skill。
        # 故 is_superadmin=true 无视部门、返回全公司 org 树。普通用户仍严格按部门子树。
        if user.get("is_superadmin"):
            self._nodes = self._load_all()
        elif dept:
            self._nodes = self._load_subtree(dept["id"])
        else:
            self._nodes = []
        self._refs = {n.scope_ref for n in self._nodes}
        return actor

    def _load_all(self) -> list:
        with self._conn.cursor() as cur:
            cur.execute("SELECT id, parent_id, name FROM departments ORDER BY id")
            depts = cur.fetchall()
        dept_ids = {r[0] for r in depts}
        nodes = [
            ScopeNode(f"dept:{did}", name, f"dept:{pid}" if pid in dept_ids else None)
            for (did, pid, name) in depts
        ]
        with self._conn.cursor() as cur:
            cur.execute("SELECT id, name, dept_id FROM positions ORDER BY id")
            nodes += [
                ScopeNode(f"pos:{pid}", name, f"dept:{did}" if did is not None else None)
                for (pid, name, did) in cur.fetchall()
            ]
        return nodes

    def _load_subtree(self, dept_id) -> list:
        with self._conn.cursor() as cur:
            cur.execute(
                "WITH RECURSIVE sub AS ("
                "  SELECT id, parent_id, name FROM departments WHERE id=%s"
                "  UNION ALL"
                "  SELECT d.id, d.parent_id, d.name FROM departments d JOIN sub ON d.parent_id=sub.id"
                ") SELECT id, parent_id, name FROM sub ORDER BY id",
                (dept_id,),
            )
            depts = cur.fetchall()
        dept_ids = {r[0] for r in depts}
        nodes = [
            # 子树根的 parent_id 指向子树外 → parent_ref=None，UI 里作顶层节点
            ScopeNode(f"dept:{did}", name, f"dept:{pid}" if pid in dept_ids else None)
            for (did, pid, name) in depts
        ]
        if dept_ids:
            with self._conn.cursor() as cur:
                cur.execute(
                    "SELECT id, name, dept_id FROM positions WHERE dept_id = ANY(%s) ORDER BY id",
                    (list(dept_ids),),
                )
                nodes += [ScopeNode(f"pos:{pid}", name, f"dept:{did}") for (pid, name, did) in cur.fetchall()]
        return nodes

    def can_manage_scope(self, actor: Actor, scope_ref: str) -> bool:
        return scope_ref in self._refs

    def manageable_scope_refs(self, actor: Actor) -> set:
        return set(self._refs)

    def list_manageable_scopes(self, actor: Actor):
        return list(self._nodes)
