import os
import psycopg2
import pytest
from _lib.orgprovider import StubOrgProvider, PlatformOrgProvider, Actor

ALL_SCOPES = {"branch:sh", "dept:ops", "pos:ops-eng", "pos:ops-lead", "dept:impl", "pos:impl-eng"}

def test_ops_manages_own_dept_subtree():
    p = StubOrgProvider("u_ops")
    a = p.get_actor({})
    assert a.dept_ref == "dept:ops"
    assert p.manageable_scope_refs(a) == {"dept:ops", "pos:ops-eng", "pos:ops-lead"}

def test_no_dept_empty():
    p = StubOrgProvider("u_none")
    a = p.get_actor({})
    assert a.dept_ref is None
    assert p.manageable_scope_refs(a) == set()

def test_root_dept_manages_all():
    p = StubOrgProvider("u_root")
    a = p.get_actor({})
    assert a.dept_ref == "branch:sh"
    assert p.manageable_scope_refs(a) == ALL_SCOPES  # 根部门子树 = 全树
    assert p.can_manage_scope(a, "dept:impl") is True

def test_contract_equivalence_all_actors():
    # can_manage_scope(a,s) ⟺ s∈manageable_scope_refs(a)  —— 无 is_super
    for uid in ("u_root", "u_ops", "u_impl", "u_none"):
        p = StubOrgProvider(uid)
        a = p.get_actor({})
        mref = p.manageable_scope_refs(a)
        for s in ALL_SCOPES:
            assert p.can_manage_scope(a, s) == (s in mref)

def test_ops_cannot_manage_impl_or_ancestor():
    p = StubOrgProvider("u_ops")
    a = p.get_actor({})
    assert p.can_manage_scope(a, "dept:impl") is False       # 别部门子树外
    assert p.can_manage_scope(a, "branch:sh") is False       # 祖先节点 fail-closed


# ---- PlatformOrgProvider：读真 departments/positions（递归子树） ----
# 组织树：1 上海分公司(root,is_company) → {2 运维部 → 岗 10/11；3 实施部 → 岗 12}
@pytest.fixture
def org_conn():
    dsn = os.environ.get(
        "FELAG_CONSOLE_TEST_DSN",
        "postgres://bestfunc:bestfunc_dev@localhost:5432/felag_console_test?sslmode=disable",
    )
    c = psycopg2.connect(dsn)
    with c.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS positions, departments CASCADE")
        cur.execute(
            "CREATE TABLE departments (id BIGINT PRIMARY KEY, parent_id BIGINT, "
            "name VARCHAR(128) NOT NULL, is_company BOOLEAN NOT NULL DEFAULT false)"
        )
        cur.execute("CREATE TABLE positions (id BIGINT PRIMARY KEY, name VARCHAR(128) NOT NULL, dept_id BIGINT)")
        cur.execute(
            "INSERT INTO departments(id,parent_id,name,is_company) VALUES "
            "(1,NULL,'上海分公司',true),(2,1,'运维部',false),(3,1,'实施部',false)"
        )
        cur.execute(
            "INSERT INTO positions(id,name,dept_id) VALUES "
            "(10,'运维工程师',2),(11,'运维负责人',2),(12,'实施工程师',3)"
        )
    c.commit()
    yield c
    with c.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS positions, departments CASCADE")
    c.commit()
    c.close()


def _ident(dept_id, uid=3):
    return {"dept": {"id": dept_id}, "user": {"id": uid, "display_name": "张三"}}


def test_platform_root_manages_whole_tree(org_conn):
    p = PlatformOrgProvider(org_conn)
    a = p.get_actor(_ident(1))
    assert a.dept_ref == "dept:1" and a.user_id == "3" and a.name == "张三"
    assert p.manageable_scope_refs(a) == {"dept:1", "dept:2", "dept:3", "pos:10", "pos:11", "pos:12"}


def test_platform_subtree_only(org_conn):
    p = PlatformOrgProvider(org_conn)
    a = p.get_actor(_ident(2))
    assert p.manageable_scope_refs(a) == {"dept:2", "pos:10", "pos:11"}
    assert p.can_manage_scope(a, "dept:3") is False   # 兄弟部门子树外
    assert p.can_manage_scope(a, "dept:1") is False   # 祖先 fail-closed


def test_platform_root_parent_ref_is_none(org_conn):
    p = PlatformOrgProvider(org_conn)
    a = p.get_actor(_ident(2))
    root = next(n for n in p.list_manageable_scopes(a) if n.scope_ref == "dept:2")
    assert root.parent_ref is None                    # 子树根 parent 指向树外 → 顶层
    pos = next(n for n in p.list_manageable_scopes(a) if n.scope_ref == "pos:10")
    assert pos.parent_ref == "dept:2"


def test_platform_none_identity_fail_closed(org_conn):
    p = PlatformOrgProvider(org_conn)
    a = p.get_actor(None)                              # cron/API Key/匿名
    assert a.dept_ref is None
    assert p.manageable_scope_refs(a) == set()
    assert p.list_manageable_scopes(a) == []


def test_platform_dept_none_in_identity(org_conn):
    p = PlatformOrgProvider(org_conn)
    a = p.get_actor({"user": {"id": 9}})              # 有 user 无 dept（未分配部门）
    assert a.dept_ref is None and a.user_id == "9"
    assert p.manageable_scope_refs(a) == set()


def test_platform_superadmin_sees_whole_tree_without_dept(org_conn):
    # 超管逃生口：不挂部门(dept=None)也能管全公司 org 树
    p = PlatformOrgProvider(org_conn)
    a = p.get_actor({"user": {"id": 1, "is_superadmin": True}})
    assert a.dept_ref is None                          # 超管本身不挂部门
    assert p.manageable_scope_refs(a) == {"dept:1", "dept:2", "dept:3", "pos:10", "pos:11", "pos:12"}
    assert p.can_manage_scope(a, "dept:3") is True


def test_platform_non_superadmin_without_dept_still_empty(org_conn):
    # 非超管 + 无部门 → 仍 fail-closed（逃生口不误伤普通账号）
    p = PlatformOrgProvider(org_conn)
    a = p.get_actor({"user": {"id": 9, "is_superadmin": False}})
    assert p.manageable_scope_refs(a) == set()
