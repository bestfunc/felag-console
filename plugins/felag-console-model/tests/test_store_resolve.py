"""连接参数兜底逻辑测试(不碰真 DB,用假游标模拟)。

这层是"运维零配置"的关键:地址三级兜底 + 令牌由 felag-server 自举写库。
兜底顺序错了就会连到不存在的地址,而且报错会指向错误的方向。
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import psycopg2
from _lib import store


class FakeCursor:
    def __init__(self, owner):
        self.owner = owner
        self._result = None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        if "plg_felagmodel_config" in sql:
            k = params[0] if params else None
            v = self.owner.own.get(k)
            self._result = (v,) if v else None
        elif "plg_felagapp_config" in sql:
            if self.owner.app_table_missing:
                raise psycopg2.errors.UndefinedTable("relation does not exist")
            v = self.owner.app.get("felag_server_base")
            self._result = (v,) if v else None
        else:
            self._result = None

    def fetchone(self):
        return self._result


class FakeConn:
    def __init__(self, own=None, app=None, app_table_missing=False):
        self.own = dict(own or {})
        self.app = dict(app or {})
        self.app_table_missing = app_table_missing
        self.rolled_back = False

    def cursor(self):
        return FakeCursor(self)

    def rollback(self):
        self.rolled_back = True


def test_own_config_wins():
    """有人显式配过就听他的(手动兜底不能被自动值盖掉)。"""
    conn = FakeConn(own={"felag_server_base": "http://custom:9000"},
                    app={"felag_server_base": "http://felag-server:28080"})
    assert store.resolve_server_base(conn) == "http://custom:9000"


def test_falls_back_to_app_release_plugin_config():
    """没配过 → 复用客户端版本管理插件配过的同一个 felag-server 地址。"""
    conn = FakeConn(app={"felag_server_base": "http://felag-server:28080"})
    assert store.resolve_server_base(conn) == "http://felag-server:28080"


def test_falls_back_to_container_default_when_table_missing():
    """那个插件也没装(表不存在)→ 容器名默认值;并且必须回滚,
    否则事务处于 aborted 状态,后续用同一连接的查询会全部失败。"""
    conn = FakeConn(app_table_missing=True)
    assert store.resolve_server_base(conn) == store.DEFAULT_SERVER_BASE
    assert conn.rolled_back, "捕获 42P01 后必须 rollback,否则连接不可再用"


def test_falls_back_when_app_config_row_absent():
    """表在但没有那一行 → 同样落到默认值。"""
    conn = FakeConn(app={})
    assert store.resolve_server_base(conn) == store.DEFAULT_SERVER_BASE


def test_resolve_token_reads_own_config():
    assert store.resolve_token(FakeConn(own={"felag_model_admin_token": "tok"})) == "tok"
    assert store.resolve_token(FakeConn()) == ""
