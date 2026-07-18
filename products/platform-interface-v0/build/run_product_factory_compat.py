#!/usr/bin/env python3
"""Run the installed Product Factory with this project's Node-compatible slicer."""

from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path


def load_factory():
    cli = (Path.home() / ".local" / "bin" / "funtastic").resolve()
    module_path = cli.parent / "product_factory.py"
    if not module_path.is_file():
        raise FileNotFoundError(f"Installed Product Factory not found: {module_path}")
    spec = importlib.util.spec_from_file_location("funtastic_product_factory", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load Product Factory: {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, required=True)
    args = parser.parse_args()
    root = args.project.resolve()
    factory = load_factory()
    factory.SLICE_SCRIPT = root / "build" / "slice_with_bambu_compat.sh"
    factory.build_project(root)


if __name__ == "__main__":
    main()
