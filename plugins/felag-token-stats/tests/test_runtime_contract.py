import pathlib, yaml, json

ROOT = pathlib.Path(__file__).resolve().parents[1]
NODES = ["usage_summary", "usage_detail", "usage_export"]


def test_all_nodes_declared_in_repo():
    repo = yaml.safe_load((ROOT / "tinia-repo.yaml").read_text(encoding="utf-8"))
    assert set(repo["modules"]["nodes"]) == set(NODES)
    assert repo["table_prefix"] == "plg_felagtoken_"


def test_both_databases_are_declared():
    """跨两个库是本插件的前提:少声明一个,凭据就不会被注入,节点起步就报 DSN 未注入。"""
    repo = yaml.safe_load((ROOT / "tinia-repo.yaml").read_text(encoding="utf-8"))
    assert {d["alias"] for d in repo["required_dbs"]} == {"platform_pg", "litellm_pg"}


def test_only_aggregate_node_is_exposed_to_mcp():
    """明细带员工归属 + 设备 + IP,不给外部 AI 批量抓取入口。"""
    repo = yaml.safe_load((ROOT / "tinia-repo.yaml").read_text(encoding="utf-8"))
    assert repo["mcp"]["expose"] == ["usage_summary"]


def test_each_node_has_contract_files():
    for k in NODES:
        d = ROOT / "nodes" / k
        assert (d / "node.yaml").exists()
        assert (d / "runtime" / "run.py").exists()
        assert (d / "schemas" / "params.schema.json").exists()
        ny = yaml.safe_load((d / "node.yaml").read_text(encoding="utf-8"))
        assert ny["key"] == k
        json.loads((d / "schemas" / "params.schema.json").read_text(encoding="utf-8"))  # 合法 JSON


def test_run_py_imports_matching_handler():
    for k in NODES:
        src = (ROOT / "nodes" / k / "runtime" / "run.py").read_text(encoding="utf-8")
        assert f"handle_{k}" in src
        # 两个库都要连上,否则跨库 merge 无从谈起
        assert "connect_litellm" in src and "connect_platform" in src


def test_migration_only_touches_own_prefix():
    """守桥2:插件迁移只碰自有前缀表。"""
    sql = (ROOT / "migrations" / "001_init.up.sql").read_text(encoding="utf-8")
    import re
    for tbl in re.findall(r"CREATE TABLE IF NOT EXISTS\s+(\S+)", sql):
        assert tbl.startswith("${table_prefix}"), f"越界建表: {tbl}"
