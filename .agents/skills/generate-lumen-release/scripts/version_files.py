#!/usr/bin/env python3
"""Check or atomically synchronize Lumen's five version fields."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid


VERSION_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
FILES = (
    Path("package.json"),
    Path("package-lock.json"),
    Path("src-tauri/Cargo.toml"),
    Path("src-tauri/Cargo.lock"),
    Path("src-tauri/tauri.conf.json"),
)


class VersionError(RuntimeError):
    pass


def parse_version(value: str) -> tuple[int, int, int]:
    match = VERSION_RE.fullmatch(value)
    if not match:
        raise VersionError(f"invalid stable SemVer: {value!r}")
    return tuple(int(part) for part in match.groups())


def read_files(root: Path) -> dict[Path, str]:
    missing = [str(path) for path in FILES if not (root / path).is_file()]
    if missing:
        raise VersionError(f"missing version files: {', '.join(missing)}")
    return {path: (root / path).read_text(encoding="utf-8") for path in FILES}


def json_versions(files: dict[Path, str]) -> dict[str, str]:
    package = json.loads(files[Path("package.json")])
    package_lock = json.loads(files[Path("package-lock.json")])
    tauri = json.loads(files[Path("src-tauri/tauri.conf.json")])
    try:
        return {
            "package.json": package["version"],
            "package-lock.json": package_lock["version"],
            'package-lock.json packages[""]': package_lock["packages"][""]["version"],
            "src-tauri/tauri.conf.json": tauri["version"],
        }
    except (KeyError, TypeError) as error:
        raise VersionError(f"unexpected JSON version structure: {error}") from error


def toml_package_version(text: str, heading: str, package_name: str | None = None) -> str:
    if heading == "package":
        match = re.search(r"(?ms)^\[package\]\s*$(.*?)(?=^\[|\Z)", text)
        if not match:
            raise VersionError("missing [package] section in Cargo.toml")
        block = match.group(1)
    else:
        blocks = re.finditer(r"(?ms)^\[\[package\]\]\s*$.*?(?=^\[\[package\]\]|\Z)", text)
        block = next(
            (
                candidate.group(0)
                for candidate in blocks
                if re.search(rf'(?m)^name\s*=\s*"{re.escape(package_name or "")}"\s*$', candidate.group(0))
            ),
            None,
        )
        if block is None:
            raise VersionError(f"missing {package_name!r} package in Cargo.lock")
    version = re.search(r'(?m)^version\s*=\s*"([^"]+)"\s*$', block)
    if not version:
        raise VersionError(f"missing version in Cargo {heading} block")
    return version.group(1)


def collect_versions(files: dict[Path, str]) -> dict[str, str]:
    versions = json_versions(files)
    versions["src-tauri/Cargo.toml"] = toml_package_version(
        files[Path("src-tauri/Cargo.toml")], "package"
    )
    versions['src-tauri/Cargo.lock package "lumen"'] = toml_package_version(
        files[Path("src-tauri/Cargo.lock")], "lock", "lumen"
    )
    for value in versions.values():
        parse_version(value)
    return versions


def synchronized_version(files: dict[Path, str]) -> str:
    versions = collect_versions(files)
    unique = set(versions.values())
    if len(unique) != 1:
        details = ", ".join(f"{name}={value}" for name, value in versions.items())
        raise VersionError(f"version fields are not synchronized: {details}")
    return unique.pop()


def replace_once(text: str, pattern: str, replacement: str, label: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise VersionError(f"could not replace exactly one {label} field")
    return updated


def update_json_files(files: dict[Path, str], new_version: str) -> None:
    package_path = Path("package.json")
    files[package_path] = replace_once(
        files[package_path],
        r'(?m)^(\s*"version"\s*:\s*")[^"]+("\s*,)',
        rf"\g<1>{new_version}\g<2>",
        "package.json version",
    )

    lock_path = Path("package-lock.json")
    lock = json.loads(files[lock_path])
    lock["version"] = new_version
    lock["packages"][""]["version"] = new_version
    newline = "\r\n" if "\r\n" in files[lock_path] else "\n"
    files[lock_path] = json.dumps(lock, ensure_ascii=False, indent=2) + newline

    tauri_path = Path("src-tauri/tauri.conf.json")
    files[tauri_path] = replace_once(
        files[tauri_path],
        r'(?m)^(\s*"version"\s*:\s*")[^"]+("\s*,)',
        rf"\g<1>{new_version}\g<2>",
        "tauri.conf.json version",
    )


def update_cargo_files(files: dict[Path, str], new_version: str) -> None:
    manifest_path = Path("src-tauri/Cargo.toml")
    manifest = files[manifest_path]
    section = re.search(r"(?ms)^\[package\]\s*$(.*?)(?=^\[|\Z)", manifest)
    if not section:
        raise VersionError("missing [package] section in Cargo.toml")
    updated_section = replace_once(
        section.group(0),
        r'(?m)^(version\s*=\s*")[^"]+("\s*)$',
        rf"\g<1>{new_version}\g<2>",
        "Cargo.toml package version",
    )
    files[manifest_path] = manifest[: section.start()] + updated_section + manifest[section.end() :]

    lock_path = Path("src-tauri/Cargo.lock")
    lock = files[lock_path]
    blocks = list(re.finditer(r"(?ms)^\[\[package\]\]\s*$.*?(?=^\[\[package\]\]|\Z)", lock))
    matches = [
        block
        for block in blocks
        if re.search(r'(?m)^name\s*=\s*"lumen"\s*$', block.group(0))
    ]
    if len(matches) != 1:
        raise VersionError(f"expected one lumen package in Cargo.lock, found {len(matches)}")
    block = matches[0]
    updated_block = replace_once(
        block.group(0),
        r'(?m)^(version\s*=\s*")[^"]+("\s*)$',
        rf"\g<1>{new_version}\g<2>",
        "Cargo.lock lumen version",
    )
    files[lock_path] = lock[: block.start()] + updated_block + lock[block.end() :]


def local_tag_exists(root: Path, version: str) -> bool:
    result = subprocess.run(
        ["git", "rev-parse", "--verify", "--quiet", f"refs/tags/v{version}"],
        cwd=root,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def write_atomically(root: Path, originals: dict[Path, str], updated: dict[Path, str]) -> None:
    token = uuid.uuid4().hex
    staged: dict[Path, Path] = {}
    replaced: list[Path] = []
    try:
        for relative, contents in updated.items():
            destination = root / relative
            temporary = destination.with_name(f".{destination.name}.{token}.tmp")
            temporary.write_text(contents, encoding="utf-8", newline="")
            staged[relative] = temporary
        for relative in FILES:
            os.replace(staged[relative], root / relative)
            replaced.append(relative)
    except Exception:
        for relative in replaced:
            destination = root / relative
            rollback = destination.with_name(f".{destination.name}.{token}.rollback")
            rollback.write_text(originals[relative], encoding="utf-8", newline="")
            os.replace(rollback, destination)
        raise
    finally:
        for temporary in staged.values():
            temporary.unlink(missing_ok=True)


def command_check(root: Path, expect: str | None) -> int:
    current = synchronized_version(read_files(root))
    if expect is not None:
        parse_version(expect)
        if current != expect:
            raise VersionError(f"expected version {expect}, found {current}")
    print(current)
    return 0


def command_set(root: Path, new_version: str) -> int:
    parse_version(new_version)
    originals = read_files(root)
    current = synchronized_version(originals)
    if parse_version(new_version) <= parse_version(current):
        raise VersionError(f"new version {new_version} must be greater than current version {current}")
    if local_tag_exists(root, new_version):
        raise VersionError(f"local tag v{new_version} already exists")

    updated = dict(originals)
    update_json_files(updated, new_version)
    update_cargo_files(updated, new_version)
    if synchronized_version(updated) != new_version:
        raise VersionError("updated files failed the synchronization check")
    write_atomically(root, originals, updated)
    print(f"{current} -> {new_version}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    check_parser = subparsers.add_parser("check", help="check that all version fields match")
    check_parser.add_argument("--root", type=Path, default=Path.cwd())
    check_parser.add_argument("--expect")
    set_parser = subparsers.add_parser("set", help="set all version fields")
    set_parser.add_argument("version")
    set_parser.add_argument("--root", type=Path, default=Path.cwd())
    return parser


def main() -> int:
    args = build_parser().parse_args()
    root = args.root.resolve()
    try:
        if args.command == "check":
            return command_check(root, args.expect)
        return command_set(root, args.version)
    except (VersionError, json.JSONDecodeError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
