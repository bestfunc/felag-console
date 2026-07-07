import io, tarfile, pytest
from _lib.pkgvalidate import validate_package, PackageError, MAX_RAW

def _mk_targz(members):  # members: list[(name, bytes)]
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for n, data in members:
            ti = tarfile.TarInfo(n)
            ti.size = len(data)
            tf.addfile(ti, io.BytesIO(data))
    return buf.getvalue()

def _mk_targz_with_dir(name):
    return _mk_targz([(f"{name}/", b""), (f"{name}/SKILL.md", b"# hi")])

def test_valid_package_ok():
    validate_package(_mk_targz_with_dir("deploy"), "deploy")  # 不抛

def test_reject_oversize():
    big = b"x" * (MAX_RAW + 1)
    with pytest.raises(PackageError, match="超过"):
        validate_package(big, "deploy")

def test_reject_not_gz():
    with pytest.raises(PackageError, match="解开|gz|tar"):
        validate_package(b"not a tarball", "deploy")

def test_reject_path_traversal():
    raw = _mk_targz([("deploy/", b""), ("deploy/../evil", b"x")])
    with pytest.raises(PackageError, match="路径"):
        validate_package(raw, "deploy")

def test_reject_absolute_path():
    raw = _mk_targz([("deploy/", b""), ("/etc/passwd", b"x")])
    with pytest.raises(PackageError, match="路径|绝对"):
        validate_package(raw, "deploy")

def test_reject_top_dir_mismatch():
    raw = _mk_targz_with_dir("other")
    with pytest.raises(PackageError, match="顶层目录"):
        validate_package(raw, "deploy")

def test_reject_symlink():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        d = tarfile.TarInfo("deploy/"); d.type = tarfile.DIRTYPE; tf.addfile(d)
        ln = tarfile.TarInfo("deploy/link"); ln.type = tarfile.SYMTYPE; ln.linkname = "/etc/passwd"
        tf.addfile(ln)
    with pytest.raises(PackageError, match="symlink|链接|类型"):
        validate_package(buf.getvalue(), "deploy")
