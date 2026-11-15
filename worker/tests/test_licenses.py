"""A política de licenças do ambiente Python reflete a allowlist do ADR-0003."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import check_licenses as policy  # noqa: E402


def test_allowlist_accepts_permissive_and_rejects_copyleft_or_unknown():
    assert policy.expression_ok("MIT", None)
    assert policy.expression_ok("MPL-2.0 AND MIT", None)
    assert policy.expression_ok("Apache-2.0 OR BSD-2-Clause", None)
    assert policy.expression_ok("GPL-3.0-only OR MIT", None)
    assert not policy.expression_ok("GPL-3.0-only", None)
    assert not policy.expression_ok("MIT AND LGPL-2.1-or-later", None)
    assert not policy.expression_ok("PSF-2.0", None)


def test_package_exception_covers_only_its_own_license():
    assert policy.expression_ok("MIT AND CC0-1.0", "CC0-1.0")
    assert not policy.expression_ok("MIT AND GPL-3.0-only", "CC0-1.0")


def test_cuda_extra_contains_only_reviewed_nvidia_packages():
    ok, names = policy.cuda_extra_is_only_nvidia(Path(policy.__file__).resolve().parent)
    assert ok, names
    assert names


def test_onnx_variants_are_mutually_exclusive_and_pinned():
    import tomllib
    project = tomllib.loads((Path(policy.__file__).parent / "pyproject.toml").read_text())
    extras = project["project"]["optional-dependencies"]
    assert "onnxruntime==1.32.0" in extras["cpu"]
    assert "onnxruntime-gpu==1.32.0; sys_platform == 'linux' or sys_platform == 'win32'" in extras["cuda"]
    assert [{"extra": "cpu"}, {"extra": "cuda"}] in project["tool"]["uv"]["conflicts"]
