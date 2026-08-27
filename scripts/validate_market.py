#!/usr/bin/env python3
"""Validate the ClassSchedule XHP market without third-party dependencies."""

from __future__ import annotations

import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "market" / "index.json"
UPDATE_PATH = ROOT / "app" / "update.json"
ALLOWED_ENTRIES = {"plugin.json", "main.js", "icon.png", "theme.json"}
KNOWN_CAPABILITIES = {
    "course_import",
    "background_sync",
    "theming",
    "hooks",
    "web_ui",
    "native_dialog",
    "headless_action",
}
ID_PATTERN = re.compile(r"^[a-z][a-z0-9.\-]{6,126}[a-z0-9]$")
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")
OFFICIAL_RAW_PREFIX = "https://raw.githubusercontent.com/xialuo0511/ClassSchedule-XHP-Market/main/"
OFFICIAL_RELEASE_PREFIX = "https://github.com/xialuo0511/ClassSchedule-XHP-Market/releases/download/"


class ValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"Cannot read JSON {path.relative_to(ROOT)}: {exc}") from exc


def validate_manifest(manifest: dict, directory_id: str) -> None:
    plugin_id = manifest.get("id")
    version = manifest.get("version")
    protocol = manifest.get("protocolVersion")
    require(plugin_id == directory_id, f"Plugin directory and id differ: {directory_id} != {plugin_id}")
    require(isinstance(plugin_id, str) and ID_PATTERN.fullmatch(plugin_id) is not None, f"Invalid plugin id: {plugin_id}")
    require(isinstance(version, str) and VERSION_PATTERN.fullmatch(version) is not None, f"Invalid version for {plugin_id}: {version}")
    require(protocol in (1, 2, 3), f"Unsupported protocolVersion for {plugin_id}: {protocol}")
    require(isinstance(manifest.get("name"), str) and 1 <= len(manifest["name"]) <= 50, f"Invalid name for {plugin_id}")
    require(isinstance(manifest.get("author"), str) and len(manifest["author"]) <= 80, f"Invalid author for {plugin_id}")
    require(isinstance(manifest.get("description"), str) and len(manifest["description"]) <= 120, f"Invalid description for {plugin_id}")
    capabilities = manifest.get("capabilities", [])
    if protocol == 1:
        require("capabilities" not in manifest and "activation" not in manifest, f"Protocol 1 plugin {plugin_id} cannot declare capabilities or activation")
    else:
        require(isinstance(capabilities, list) and capabilities, f"Plugin {plugin_id} must declare capabilities")
        require(set(capabilities) <= KNOWN_CAPABILITIES, f"Plugin {plugin_id} declares unknown capabilities")
    if protocol == 3:
        require(isinstance(manifest.get("activation"), dict), f"Protocol 3 plugin {plugin_id} must declare activation")


def validate_package(entry: dict, source_dir: Path) -> None:
    package_path = ROOT / entry["packagePath"]
    require(package_path.is_file(), f"Package does not exist: {entry['packagePath']}")
    require(package_path.stat().st_size <= 2 * 1024 * 1024, f"Package exceeds 2 MiB: {entry['packagePath']}")
    digest = hashlib.sha256(package_path.read_bytes()).hexdigest()
    require(digest == entry["sha256"], f"SHA-256 differs for {entry['id']}: expected {entry['sha256']}, got {digest}")

    try:
        with zipfile.ZipFile(package_path) as archive:
            names = archive.namelist()
            require(len(names) == len(set(names)), f"Duplicate ZIP entries in {entry['packagePath']}")
            require(set(names) <= ALLOWED_ENTRIES, f"Unexpected ZIP entries in {entry['packagePath']}: {sorted(set(names) - ALLOWED_ENTRIES)}")
            require({"plugin.json", "main.js"} <= set(names), f"Required root files missing in {entry['packagePath']}")
            for name in names:
                path = PurePosixPath(name)
                require(len(path.parts) == 1 and name == path.name, f"Nested or unsafe ZIP entry: {name}")
            embedded_manifest = json.loads(archive.read("plugin.json").decode("utf-8-sig"))
            source_manifest_bytes = (source_dir / "plugin.json").read_bytes()
            source_script_bytes = (source_dir / "main.js").read_bytes()
            require(archive.read("plugin.json") == source_manifest_bytes, f"Packaged plugin.json differs from source for {entry['id']}")
            require(archive.read("main.js") == source_script_bytes, f"Packaged main.js differs from source for {entry['id']}")
    except (OSError, zipfile.BadZipFile, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationError(f"Invalid package {entry['packagePath']}: {exc}") from exc

    require(embedded_manifest.get("id") == entry["id"], f"Package id differs for {entry['id']}")
    require(embedded_manifest.get("version") == entry["latestVersion"], f"Package version differs for {entry['id']}")
    require(embedded_manifest.get("protocolVersion") == entry["protocolVersion"], f"Package protocol differs for {entry['id']}")


def validate() -> None:
    index = read_json(INDEX_PATH)
    require(index.get("schemaVersion") == 1, "market/index.json must use schemaVersion 1")
    plugins = index.get("plugins")
    require(isinstance(plugins, list), "market/index.json plugins must be an array")

    seen_ids: set[str] = set()
    for entry in plugins:
        require(isinstance(entry, dict), "Every market entry must be an object")
        plugin_id = entry.get("id")
        require(isinstance(plugin_id, str) and plugin_id not in seen_ids, f"Duplicate or invalid plugin id: {plugin_id}")
        seen_ids.add(plugin_id)
        require(VERSION_PATTERN.fullmatch(str(entry.get("latestVersion", ""))) is not None, f"Invalid latestVersion for {plugin_id}")
        require(isinstance(entry.get("minAppVersionCode"), int) and entry["minAppVersionCode"] >= 1, f"Invalid minAppVersionCode for {plugin_id}")
        require(re.fullmatch(r"[a-f0-9]{64}", str(entry.get("sha256", ""))) is not None, f"Invalid SHA-256 for {plugin_id}")
        expected_path = f"packages/{plugin_id}/{entry['latestVersion']}/{Path(entry['packagePath']).name}"
        require(entry.get("packagePath") == expected_path, f"Unexpected packagePath for {plugin_id}")
        require(
            entry.get("downloadUrl") == OFFICIAL_RAW_PREFIX + expected_path,
            f"Download URL must use the official raw repository for {plugin_id}",
        )
        require(str(entry.get("sourceUrl", "")).startswith("https://github.com/xialuo0511/ClassSchedule-XHP-Market/"), f"Invalid sourceUrl for {plugin_id}")
        source_dir = ROOT / "plugins" / plugin_id
        require(source_dir.is_dir(), f"Source directory missing for {plugin_id}")
        require((source_dir / "main.js").is_file() and (source_dir / "main.js").stat().st_size > 0, f"main.js missing or empty for {plugin_id}")
        manifest = read_json(source_dir / "plugin.json")
        validate_manifest(manifest, plugin_id)
        require(manifest.get("version") == entry["latestVersion"], f"Index version differs from source for {plugin_id}")
        require(manifest.get("protocolVersion") == entry["protocolVersion"], f"Index protocol differs from source for {plugin_id}")
        require(manifest.get("name") == entry.get("name"), f"Index name differs from source for {plugin_id}")
        require(manifest.get("author") == entry.get("author"), f"Index author differs from source for {plugin_id}")
        require(manifest.get("description") == entry.get("description"), f"Index description differs from source for {plugin_id}")
        require(manifest.get("capabilities", []) == entry.get("capabilities", []), f"Index capabilities differ from source for {plugin_id}")
        validate_package(entry, source_dir)

    source_ids = {path.name for path in (ROOT / "plugins").iterdir() if path.is_dir()}
    require(source_ids == seen_ids, f"Index/source plugin sets differ: index={sorted(seen_ids)}, source={sorted(source_ids)}")
    print(f"Validated {len(plugins)} plugins and their XHP packages.")
    update = read_json(UPDATE_PATH)
    require(update.get("schemaVersion") == 1, "app/update.json must use schemaVersion 1")
    require(isinstance(update.get("versionCode"), int) and update["versionCode"] >= 1, "Invalid app versionCode")
    require(isinstance(update.get("versionName"), str) and update["versionName"], "Invalid app versionName")
    require(
        str(update.get("downloadUrl", "")).startswith(OFFICIAL_RELEASE_PREFIX),
        "App downloadUrl must use the official GitHub Release",
    )
    require(re.fullmatch(r"[a-f0-9]{64}", str(update.get("sha256", ""))) is not None, "Invalid app SHA-256")
    notes = update.get("releaseNotes")
    require(isinstance(notes, list) and all(isinstance(note, str) and note for note in notes), "Invalid app releaseNotes")
    print(f"Validated app update metadata for {update['versionName']}.")


if __name__ == "__main__":
    try:
        validate()
    except ValidationError as exc:
        print(f"Validation failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
