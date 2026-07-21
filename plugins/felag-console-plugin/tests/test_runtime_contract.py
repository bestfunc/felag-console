import pathlib, yaml, json

ROOT = pathlib.Path(__file__).resolve().parents[1]
NODES = ["actor_context", "plugin_source_list", "plugin_source_create",
         "plugin_source_review", "plugin_source_delete", "plugin_source_sync",
         "plugin_source_rename", "plugin_discover", "audit_list",
         "official_list", "official_enable", "official_disable", "official_set_creds"]

def test_all_nodes_declared_in_repo():
    repo = yaml.safe_load((ROOT / "tinia-repo.yaml").read_text(encoding="utf-8"))
    assert set(repo["modules"]["nodes"]) == set(NODES)
    assert repo["table_prefix"] == "plg_felagplugin_"

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
    hmap = {"actor_context": "handle_actor_context", "plugin_source_list": "handle_plugin_source_list",
            "plugin_source_create": "handle_plugin_source_create", "plugin_source_review": "handle_plugin_source_review",
            "plugin_source_delete": "handle_plugin_source_delete", "plugin_source_sync": "handle_plugin_source_sync",
            "plugin_source_rename": "handle_plugin_source_rename", "plugin_discover": "handle_plugin_discover",
            "audit_list": "handle_audit_list", "official_list": "handle_official_list",
            "official_enable": "handle_official_enable", "official_disable": "handle_official_disable",
            "official_set_creds": "handle_official_set_creds"}
    for k, h in hmap.items():
        src = (ROOT / "nodes" / k / "runtime" / "run.py").read_text(encoding="utf-8")
        assert h in src   # run.py 导入并调用对应 handler
