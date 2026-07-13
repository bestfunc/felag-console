import pathlib, yaml, json

ROOT = pathlib.Path(__file__).resolve().parents[1]
NODES = ["release_list", "release_upload", "release_publish", "release_delete"]

def test_all_nodes_declared_in_repo():
    repo = yaml.safe_load((ROOT / "tinia-repo.yaml").read_text(encoding="utf-8"))
    assert set(repo["modules"]["nodes"]) == set(NODES)
    assert repo["table_prefix"] == "plg_felagapp_"

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
    hmap = {n: f"handle_{n}" for n in NODES}
    for k, h in hmap.items():
        src = (ROOT / "nodes" / k / "runtime" / "run.py").read_text(encoding="utf-8")
        assert h in src   # run.py 导入并调用对应 handler
