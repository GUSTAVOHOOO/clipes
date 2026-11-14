"""Verifica as licenças do ambiente Python fixado do worker (ADR-0003).

Usa a mesma allowlist de deny.toml, scripts/license-policy.mjs e do teste do
manifesto de Componentes. Falha para licença ausente, desconhecida ou fora da lista.
Rode dentro do ambiente instalado: `uv run --project worker python worker/check_licenses.py`.
"""

import re
import sys
import tomllib
from importlib import metadata
from pathlib import Path

ALLOWED = {
    "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib",
    "Unicode-3.0", "MPL-2.0", "MIT-0", "CDLA-Permissive-2.0", "bzip2-1.0.6",
    "BSL-1.0", "OFL-1.1", "0BSD", "Unlicense", "Apache-2.0 WITH LLVM-exception",
}

# Exceções por pacote, cada uma com a razão, aprovadas pelo mantenedor em 2026-11-14 (PR #111)
# (CONTRIBUTING.md, "Licenças de dependências"): nada entra aqui sem justificativa.
EXCEPTIONS = {
    # Texto da licença PSF-2.0 (permissiva, a mesma do Python); só a anotação de tipos.
    "typing-extensions": "PSF-2.0",
    # Parte do pacote numpy (dados de teste/algoritmos) sob CC0-1.0, de domínio público.
    "numpy": "CC0-1.0",
}
# Bibliotecas CUDA proprietárias (EULA da NVIDIA, redistribuíveis), baixadas só com GPU
# NVIDIA como extra `cuda`. Não são instaladas no CI; o script confere que o extra
# contém apenas estes pacotes.
NVIDIA_CUDA = {"nvidia-cublas-cu12", "nvidia-cudnn-cu12"}

CLASSIFIERS = {
    "License :: OSI Approved :: MIT License": "MIT",
    "License :: OSI Approved :: Apache Software License": "Apache-2.0",
    "License :: OSI Approved :: BSD License": "BSD-3-Clause",
    "License :: OSI Approved :: ISC License (ISCL)": "ISC",
    "License :: OSI Approved :: Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "License :: OSI Approved :: zlib/libpng License": "Zlib",
    "License :: CC0 1.0 Universal (CC0 1.0) Public Domain Dedication": "CC0-1.0",
    "License :: OSI Approved :: Python Software Foundation License": "PSF-2.0",
    "License :: Public Domain": "Unlicense",
}
FREE_TEXT = (
    (re.compile(r"^\s*(the )?mit( license)?\s*$", re.I), "MIT"),
    (re.compile(r"^\s*apache([- ]license)?[- ]?(software license)?[- ,]*(version )?2(\.0)?\s*$", re.I), "Apache-2.0"),
    (re.compile(r"^\s*(3[- ]clause )?bsd([- ]3[- ]clause)?( license)?\s*$", re.I), "BSD-3-Clause"),
    (re.compile(r"^\s*mpl[- ]2\.0\s*$", re.I), "MPL-2.0"),
)


def expression_ok(expression, extra):
    """Avalia uma expressão SPDX simples (AND/OR, sem parênteses aninhados)."""
    expression = expression.replace("(", " ").replace(")", " ")
    ok = lambda name: name in ALLOWED or name == extra
    return any(
        all(ok(term.strip()) for term in re.split(r"\s+AND\s+", alt) if term.strip())
        for alt in re.split(r"\s+OR\s+", expression)
    )


def licenses_of(dist):
    meta = dist.metadata
    expression = meta.get("License-Expression")
    if expression:
        return expression
    text = (meta.get("License") or "").strip()
    first = text.splitlines()[0] if text else ""
    for pattern, spdx in FREE_TEXT:
        if pattern.match(first):
            return spdx
    if first and len(first) < 60 and expression_ok(first, None):
        return first  # já é uma expressão SPDX (ex.: "MPL-2.0 AND MIT")
    found = {CLASSIFIERS[c] for c in meta.get_all("Classifier") or [] if c in CLASSIFIERS}
    if found:
        return " OR ".join(sorted(found))
    return None


def cuda_extra_is_only_nvidia(root):
    lock = tomllib.loads((root / "uv.lock").read_text(encoding="utf-8"))
    for package in lock["package"]:
        if package["name"] == "clipes-worker":
            names = {dep["name"] for dep in package["optional-dependencies"]["cuda"]}
            return names <= NVIDIA_CUDA, names
    raise SystemExit("clipes-worker ausente do uv.lock")


def main():
    failed = False
    checked = 0
    for dist in sorted(metadata.distributions(), key=lambda d: d.metadata["Name"].lower()):
        name = dist.metadata["Name"].lower().replace("_", "-")
        if name in ("clipes-worker", "pip", "setuptools", "wheel", "pytest", "iniconfig", "pluggy", "pygments"):
            continue  # ferramentas de desenvolvimento, não vão para o ambiente do usuário
        expression = licenses_of(dist)
        extra = EXCEPTIONS.get(name)
        if expression is None or not expression_ok(expression, extra):
            print(f"{name}: licença não permitida ou desconhecida: {expression!r}", file=sys.stderr)
            failed = True
        checked += 1
    root = Path(__file__).resolve().parent
    only_nvidia, names = cuda_extra_is_only_nvidia(root)
    if not only_nvidia:
        print(f"extra cuda contém pacotes não revisados: {sorted(names - NVIDIA_CUDA)}", file=sys.stderr)
        failed = True
    if not checked:
        print("Nenhuma dependência verificada", file=sys.stderr)
        failed = True
    if failed:
        return 1
    print(f"{checked} pacotes aprovados")
    return 0


if __name__ == "__main__":
    sys.exit(main())
