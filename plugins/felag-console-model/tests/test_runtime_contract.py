import pathlib
import yaml
import json

ROOT = pathlib.Path(__file__).resolve().parents[1]
NODES = ["model_list", "model_upsert", "model_delete", "model_set_config",
         "model_set_role", "model_test"]


def _repo():
    return yaml.safe_load((ROOT / "tinia-repo.yaml").read_text(encoding="utf-8"))


def test_all_nodes_declared_in_repo():
    repo = _repo()
    assert set(repo["modules"]["nodes"]) == set(NODES)
    assert repo["table_prefix"] == "plg_felagmodel_"


def test_each_node_has_contract_files():
    for k in NODES:
        d = ROOT / "nodes" / k
        assert (d / "node.yaml").exists()
        assert (d / "runtime" / "run.py").exists()
        assert (d / "schemas" / "params.schema.json").exists()
        ny = yaml.safe_load((d / "node.yaml").read_text(encoding="utf-8"))
        assert ny["key"] == k
        json.loads((d / "schemas" / "params.schema.json").read_text(encoding="utf-8"))


def test_run_py_imports_matching_handler():
    for k in NODES:
        src = (ROOT / "nodes" / k / "runtime" / "run.py").read_text(encoding="utf-8")
        assert f"handle_{k}" in src


def test_mcp_exposes_read_only_nodes_only():
    """🔒 改网关模型与上游密钥直接决定 LLM 账单与可用性 —— 写操作绝不给外部 AI 调用入口。
    (与 felag-app-release 只暴露 release_list 同规矩。)"""
    exposed = set(_repo().get("mcp", {}).get("expose", []))
    assert exposed == {"model_list"}, f"只允许暴露只读清单,当前: {exposed}"


def test_migration_has_no_models_table():
    """模型的真相源是网关,平台库只存连接配置与审计。
    这里一旦出现 models 表,就意味着要么存了密钥、要么与网关双写不一致。"""
    sql = (ROOT / "migrations" / "001_init.up.sql").read_text(encoding="utf-8").lower()
    assert "${table_prefix}config" in sql and "${table_prefix}audit" in sql
    assert "models (" not in sql and "model (" not in sql
