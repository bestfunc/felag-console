"""超管 provider(与 felag-app-release 同构)。

**本期用量统计仅超管可见**(spec §11 已拍板):它把全公司数字员工的 token 消耗、设备与 IP
摆在一页上,不做部门分权。identity 缺失(cron / API Key / 匿名)→ is_superadmin=False →
fail-closed,所有节点拒。将来要放开部门管理员,在这里加 scope 反查,节点层不用动。
"""
from __future__ import annotations
from dataclasses import dataclass


@dataclass
class Actor:
    user_id: str          # 平台 users.id（审计归属）
    name: str
    is_superadmin: bool


class PlatformSuperadminProvider:
    """读平台 identity 判超管。identity 由平台 worker 注入,
    结构与 felag-console 一致:{"user": {"id","username","display_name","is_superadmin"}, ...}。"""

    def get_actor(self, identity) -> Actor:
        ident = identity or {}
        user = ident.get("user") or {}
        uid = user.get("id")
        return Actor(
            user_id=str(uid) if uid is not None else "",
            name=user.get("display_name") or user.get("username") or "",
            is_superadmin=bool(user.get("is_superadmin")),
        )


class StubSuperadminProvider:
    """无 DB 内存桩,仅供单测注入。默认超管;传 is_superadmin=False 测拒绝路径。"""

    def __init__(self, is_superadmin: bool = True, user_id: str = "1", name: str = "超管"):
        self._is_super = is_superadmin
        self._uid = user_id
        self._name = name

    def get_actor(self, identity) -> Actor:
        return Actor(user_id=self._uid, name=self._name, is_superadmin=self._is_super)
