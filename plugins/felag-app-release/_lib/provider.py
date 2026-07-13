"""超管 provider。**客户端版本是全局的**(不分部门 / 无 scope 反查,见 spec §6.1)——
所有节点仅超管可用。PlatformSuperadminProvider 读平台 identity 的 is_superadmin 为生产实现;
StubSuperadminProvider 是无 DB 的内存桩,供本地单测注入。两者接口同构,run.py 换类即可。

get_actor 从平台 worker 注入的 identity(rt.identity)取 user 信息;cron / API Key / 匿名 →
user 缺失 → is_superadmin=False → fail-closed(所有节点拒)。"""
from __future__ import annotations
from dataclasses import dataclass

@dataclass
class Actor:
    user_id: str          # 平台 users.id（审计归属）
    name: str
    is_superadmin: bool

class PlatformSuperadminProvider:
    """读平台 identity 判超管(is_superadmin)。identity 由平台 worker 注入,
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
